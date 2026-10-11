import type pg from "pg";
import { accessTokenFor } from "./connections";
import { GoogleApiError, type GoogleClient } from "./google";

// Copies busy times from each host's Google calendars into busy_blocks, which the slot engine reads. A connection
// whose last good sync is older than 15 minutes stops all slots (src/lib/slots.ts), so a broken calendar can never
// let someone book over a meeting; the host gets one email per outage telling them to fix it.

export const SYNC_EVERY_MINUTES = 5;
/** How long a running sync holds its connection; longer than any sync takes, short enough that a crash doesn't stall it. */
const SYNC_CLAIM_MINUTES = 2;
/** While a connection is failing, try again sooner than the normal interval. */
const RETRY_FAILING_MINUTES = 2;
/** After this many failures in a row (about 4 minutes of retries plus the stale window) the host is told. */
export const ALERT_AFTER_FAILURES = 3;
const DAY = 86_400_000;
/** Free/busy is fetched in windows of this many days. */
const CHUNK_DAYS = 60;

export interface SyncResult { connectionId: string; ok: boolean; error?: string }

/** Claims due connections (several servers can run this at once) and syncs each. Demo connections without tokens are skipped. */
export async function syncDueConnections(pool: pg.Pool, google: GoogleClient, key: Buffer, now = new Date(), limit = 5): Promise<SyncResult[]> {
  const { rows } = await pool.query(
    `update calendar_connections c set next_sync_at = $1::timestamptz + make_interval(mins => $3), sync_claimed_until = $1::timestamptz + make_interval(mins => $4)
     from (select id from calendar_connections
           where provider = 'google' and status <> 'disconnected' and next_sync_at <= $1 and octet_length(credentials_encrypted) > 0
             -- A sync still running holds the connection, so a ping can't start an overlapping one whose older result lands last.
             and (sync_claimed_until is null or sync_claimed_until < $1)
           order by next_sync_at limit $2 for update skip locked) due
     where c.id = due.id returning c.id`, [now, limit, SYNC_EVERY_MINUTES, SYNC_CLAIM_MINUTES]);
  const results: SyncResult[] = [];
  for (const r of rows) results.push(await syncConnection(pool, google, key, r.id as string, now));
  return results;
}

export async function syncConnection(pool: pg.Pool, google: GoogleClient, key: Buffer, connectionId: string, now = new Date()): Promise<SyncResult> {
  try {
    const { rows: [conn] } = await pool.query("select user_id from calendar_connections where id = $1", [connectionId]);
    if (!conn) return { connectionId, ok: false, error: "connection no longer exists" };
    const { rows: cals } = await pool.query("select id, external_id from calendars where connection_id = $1 and check_conflicts", [connectionId]);
    if (cals.length > 0) {
      // Far enough ahead to cover the longest booking window the host offers.
      const { rows: [{ days }] } = await pool.query(
        "select coalesce(max(booking_window_days), 60) as days from event_types where user_id = $1 and active", [conn.user_id]);
      const from = new Date(now.getTime() - DAY);
      const until = new Date(now.getTime() + (Number(days) + 1) * DAY);
      const token = await accessTokenFor(pool, google, key, connectionId, now);
      const blocks = new Map<string, { start: Date; end: Date }[]>(cals.map((c) => [c.id as string, []]));
      for (let start = from; start < until; start = new Date(start.getTime() + CHUNK_DAYS * DAY)) {
        const end = new Date(Math.min(until.getTime(), start.getTime() + CHUNK_DAYS * DAY));
        const { busy, errors } = await google.freeBusy(token, cals.map((c) => c.external_id as string), start, end);
        if (errors.size > 0) {
          const [id, reason] = [...errors][0];
          throw new GoogleApiError(`Google could not read calendar ${id}: ${reason}`, { retryable: true, reason });
        }
        for (const c of cals) blocks.get(c.id)!.push(...(busy.get(c.external_id) ?? []));
      }
      await replaceBusyBlocks(pool, conn.user_id, connectionId, blocks);
    } else {
      await pool.query("delete from busy_blocks where calendar_id in (select id from calendars where connection_id = $1)", [connectionId]);
    }
    await pool.query(
      `update calendar_connections set status = 'ok', last_synced_at = $2, error_count = 0, last_error = null, alert_sent_at = null, sync_claimed_until = null,
         next_sync_at = least(next_sync_at, $2::timestamptz + make_interval(mins => $3)), updated_at = $2 where id = $1`, [connectionId, now, SYNC_EVERY_MINUTES]);
    return { connectionId, ok: true };
  } catch (error) {
    await recordConnectionFailure(pool, connectionId, error, now);
    return { connectionId, ok: false, error: (error as Error).message };
  }
}

/** Replaces the connection's busy blocks in one transaction, so slots never see a half-written calendar. */
async function replaceBusyBlocks(pool: pg.Pool, userId: string, connectionId: string, blocks: Map<string, { start: Date; end: Date }[]>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from busy_blocks where calendar_id in (select id from calendars where connection_id = $1)", [connectionId]);
    for (const [calendarId, ranges] of blocks) {
      if (ranges.length === 0) continue;
      await client.query(
        `insert into busy_blocks (calendar_id, user_id, external_event_id, busy)
         select $1, $2, 'fb:' || s, tstzrange(s, e, '[)') from unnest($3::timestamptz[], $4::timestamptz[]) as t(s, e)
         on conflict (calendar_id, external_event_id) do nothing`,
        [calendarId, userId, ranges.map((r) => r.start), ranges.map((r) => r.end)]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Records a failed sync or calendar write. A revoked grant or missing permission disconnects the connection at once;
 * anything else marks it degraded and retries soon. The host is emailed once per outage.
 */
export async function recordConnectionFailure(pool: Pick<pg.Pool, "query">, connectionId: string, error: unknown, now: Date): Promise<void> {
  const revoked = error instanceof GoogleApiError && error.revoked;
  const message = (error as Error).message.slice(0, 500);
  const { rows: [c] } = await pool.query(
    `update calendar_connections set status = $2, error_count = error_count + 1, last_error = $3, updated_at = $4, sync_claimed_until = null,
       next_sync_at = $4::timestamptz + make_interval(mins => $5)
     where id = $1 returning user_id, error_count, alert_sent_at, account_email`,
    [connectionId, revoked ? "disconnected" : "degraded", message, now, RETRY_FAILING_MINUTES]);
  if (!c || c.alert_sent_at || (!revoked && c.error_count < ALERT_AFTER_FAILURES)) return;
  // Claim the one alert for this outage in a single statement: a sync and a calendar write failing together send one email.
  const claimed = await pool.query("update calendar_connections set alert_sent_at = $2 where id = $1 and alert_sent_at is null", [connectionId, now]);
  if (!claimed.rowCount) return;
  const { rows: [host] } = await pool.query("select email from users where id = $1 and deleted_at is null", [c.user_id]);
  if (!host) return;
  await pool.query(
    `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
     values (null, $1, 'email', 'calendar_alert_host', $2, $3, $4) on conflict (dedupe_key) do nothing`,
    [c.user_id, host.email, now, `calendar:${connectionId}:alert:${now.toISOString()}`]);
}

