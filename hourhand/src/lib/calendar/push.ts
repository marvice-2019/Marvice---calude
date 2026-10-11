import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { kickJobs } from "../jobs/kick";
import { accessTokenFor } from "./connections";
import { GoogleApiError, type GoogleClient } from "./google";
import type { CalendarProvider } from "./provider";

// Instant sync. Each calendar a host checks for conflicts gets a Google watch channel; when its events change, Google
// pings /api/webhooks/google-calendar and that connection syncs at once. The ping says nothing about what changed and
// is only a hint, so a forged or lost one can't make a slot appear free: the 5-minute poll keeps running regardless.

/** How long a channel is asked to live (Google's maximum is a week). Renewed a day before it ends. */
const CHANNEL_TTL_SECONDS = 7 * 86_400;
const RENEW_BEFORE_MS = 86_400_000;
/** A calendar Google won't watch (holidays, some shared calendars) is tried again a day later; a passing error sooner. */
const RETRY_UNSUPPORTED_MS = 86_400_000;
const RETRY_TRANSIENT_MS = 15 * 60_000;
/** A claim holds a calendar this long, so a crashed run doesn't leave it unwatched forever. */
const CLAIM_MS = 10 * 60_000;

type Env = Record<string, string | undefined>;

/**
 * Where Google should send pings, or null when push can't work: Google only calls HTTPS addresses with a valid
 * certificate, so a local http server falls back to polling. HOURHAND_E2E=1 allows the fake Google's http address.
 */
export function pushAddress(baseUrl: string, env: Env = process.env): string | null {
  const ok = baseUrl.startsWith("https://") || env.HOURHAND_E2E === "1";
  return ok ? `${baseUrl.replace(/\/+$/, "")}/api/webhooks/google-calendar` : null;
}

/** Whether a provider can run watch channels: only the Google client can (pings are Google-only). */
export function watchCapable(p: CalendarProvider): p is GoogleClient {
  return typeof (p as Partial<GoogleClient>).stopChannel === "function";
}

export interface ChannelResult { started: number; stopped: number; failed: number }

interface DueCalendar { id: string; connection_id: string; external_id: string; push_channel_id: string | null; push_resource_id: string | null }

/** Stops a channel with the connection's token. Best effort: a channel we can't stop just expires on its own. */
async function stopQuietly(pool: Pick<pg.Pool, "query">, google: GoogleClient, key: Buffer, connectionId: string, channelId: string, resourceId: string, now: Date) {
  try {
    await google.stopChannel(await accessTokenFor(pool, { google }, key, connectionId, now), channelId, resourceId);
  } catch {
    // Google stops sending once it expires; until then its pings find no matching channel and are ignored.
  }
}

/**
 * Starts channels for checked calendars that have none or whose channel ends within a day, and stops channels on
 * calendars that are no longer checked. Safe on several servers at once (claims with FOR UPDATE SKIP LOCKED).
 */
export async function maintainChannels(pool: pg.Pool, google: GoogleClient, key: Buffer, address: string, now = new Date(), limit = 10): Promise<ChannelResult> {
  const result: ChannelResult = { started: 0, stopped: 0, failed: 0 };

  // Calendars switched off (or whose connection was cut) don't need pings any more.
  const { rows: stale } = await pool.query(
    `update calendars k set push_channel_id = null, push_resource_id = null, push_token_hash = null, push_expires_at = null
     from (select k2.id, k2.push_channel_id, k2.push_resource_id from calendars k2 join calendar_connections c on c.id = k2.connection_id
           where k2.push_channel_id is not null and (not k2.check_conflicts or c.status = 'disconnected')
           limit $1 for update of k2 skip locked) s
     where k.id = s.id returning k.connection_id, s.push_channel_id, s.push_resource_id`, [limit]);
  for (const s of stale) {
    if (s.push_resource_id) await stopQuietly(pool, google, key, s.connection_id, s.push_channel_id, s.push_resource_id, now);
    result.stopped += 1;
  }

  const { rows: due } = await pool.query<DueCalendar>(
    `update calendars k set push_retry_at = $1::timestamptz + $3 * interval '1 millisecond'
     from (select k2.id from calendars k2 join calendar_connections c on c.id = k2.connection_id
           where k2.check_conflicts and c.provider = 'google' and c.status <> 'disconnected' and octet_length(c.credentials_encrypted) > 0
             and (k2.push_expires_at is null or k2.push_expires_at < $1::timestamptz + $4 * interval '1 millisecond')
             and (k2.push_retry_at is null or k2.push_retry_at <= $1)
           order by k2.push_expires_at nulls first limit $2 for update of k2 skip locked) d
     where k.id = d.id returning k.id, k.connection_id, k.external_id, k.push_channel_id, k.push_resource_id`,
    [now, limit, CLAIM_MS, RENEW_BEFORE_MS]);
  for (const cal of due) {
    try {
      const token = await accessTokenFor(pool, { google }, key, cal.connection_id, now);
      const channel = { id: randomUUID(), token: randomBytes(24).toString("hex"), address, ttlSeconds: CHANNEL_TTL_SECONDS };
      const watched = await google.watchEvents(token, cal.external_id, channel);
      const expiresAt = watched.expiresAt ?? new Date(now.getTime() + CHANNEL_TTL_SECONDS * 1000);
      await pool.query(
        `update calendars set push_channel_id = $2, push_resource_id = $3, push_token_hash = $4, push_expires_at = $5, push_error = null, push_retry_at = null
         where id = $1`, [cal.id, channel.id, watched.resourceId, tokenHash(channel.token), expiresAt]);
      // The new channel is live; the old one (if renewing) can go. They may overlap briefly, which is harmless.
      if (cal.push_channel_id && cal.push_resource_id) await stopQuietly(pool, google, key, cal.connection_id, cal.push_channel_id, cal.push_resource_id, now);
      result.started += 1;
    } catch (error) {
      result.failed += 1;
      const transient = error instanceof GoogleApiError ? error.retryable : true;
      // Polling still covers this calendar, so a failed watch is noted on the calendar and never fails the connection.
      await pool.query("update calendars set push_error = $2, push_retry_at = $3 where id = $1",
        [cal.id, (error as Error).message.slice(0, 300), new Date(now.getTime() + (transient ? RETRY_TRANSIENT_MS : RETRY_UNSUPPORTED_MS))]);
    }
  }
  return result;
}

/** Only a hash is stored, so a database reader can't forge pings. */
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function sameHash(storedHex: string, token: string): boolean {
  const x = Buffer.from(storedHex, "hex");
  const y = Buffer.from(tokenHash(token), "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** At most one ping-triggered sync per connection in this window; Google can send many pings for one change. */
export const PING_DEBOUNCE_SECONDS = 30;

export type PingOutcome = "synced" | "ignored";

/**
 * Handles one ping from Google. A ping for a live channel with the right token brings that connection's next sync
 * forward to now; anything else is ignored. Never trusts the ping for availability, only as a nudge to look again.
 */
export async function handlePing(pool: Pick<pg.Pool, "query">, headers: { channelId: string | null; token: string | null; state: string | null }, now = new Date()): Promise<PingOutcome> {
  if (!headers.channelId || !headers.token || headers.channelId.length > 100) return "ignored";
  const { rows: [cal] } = await pool.query("select connection_id, push_token_hash from calendars where push_channel_id = $1", [headers.channelId]);
  if (!cal?.push_token_hash || !sameHash(cal.push_token_hash, headers.token)) return "ignored";
  // "sync" is Google's hello when a channel starts; nothing has changed yet.
  if (headers.state !== "exists" && headers.state !== "not_exists") return "ignored";
  // Brought forward to now, but no sooner than 30s after the last sync (a burst of pings is one sync), and only for a
  // healthy connection: a failing one keeps its retry backoff, so pings can't hammer Google or hurry the outage email.
  const { rows: [due] } = await pool.query(
    `update calendar_connections set next_sync_at = greatest($2::timestamptz, coalesce(last_synced_at + make_interval(secs => $3), $2::timestamptz))
     where id = $1 and status = 'ok' and next_sync_at > greatest($2::timestamptz, coalesce(last_synced_at + make_interval(secs => $3), $2::timestamptz))
     returning next_sync_at <= $2 as now_due`, [cal.connection_id, now, PING_DEBOUNCE_SECONDS]);
  if (due?.now_due) kickJobs();
  return "synced";
}

/** Stops every channel on a connection that is about to be deleted (best effort; they'd expire within a week anyway). */
export async function stopConnectionChannels(pool: Pick<pg.Pool, "query">, google: GoogleClient, key: Buffer, connectionId: string, now = new Date()): Promise<void> {
  const { rows } = await pool.query(
    "select push_channel_id, push_resource_id from calendars where connection_id = $1 and push_channel_id is not null and push_resource_id is not null", [connectionId]);
  for (const r of rows) await stopQuietly(pool, google, key, connectionId, r.push_channel_id, r.push_resource_id, now);
}
