import type pg from "pg";
import { checkedCalendarLimit } from "../billing/account";
import { seal, unseal } from "../crypto/seal";
import { GoogleApiError, type GoogleClient, type TokenSet } from "./google";
import type { CalendarEntry } from "./provider";
import { stopConnectionChannels } from "./push";

// Stored Google connections. Tokens are sealed with TOKEN_ENCRYPTION_KEY and bound to their connection, so neither a
// database dump nor a row copied into another account's connection can be used.

type Db = Pick<pg.Pool, "query">;
interface Credentials { refreshToken: string; accessToken: string | null; expiresAt: string | null }

/** The sealed credentials are bound to the account they belong to, not to a row id that isn't known before insert. */
const aadFor = (userId: string, accountEmail: string) => `google:${userId}:${accountEmail.toLowerCase()}`;

/**
 * Saves a new or renewed Google connection and its calendars. New connections check the primary calendar for conflicts
 * and use it for booked events, unless the host already has a calendar for booked events.
 */
export async function saveGoogleConnection(pool: pg.Pool, key: Buffer, userId: string, tokens: TokenSet, calendars: CalendarEntry[], now: Date): Promise<string> {
  if (!tokens.email) throw new Error("Google did not say which account was connected");
  if (!tokens.refreshToken) throw new Error("Google did not return a refresh token");
  const creds: Credentials = { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt.toISOString() };
  const sealed = seal(key, creds, aadFor(userId, tokens.email));
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: [conn] } = await client.query(
      `insert into calendar_connections (user_id, provider, account_email, credentials_encrypted, status, granted_scopes, next_sync_at, error_count, last_error, alert_sent_at)
       values ($1, 'google', $2, $3, 'ok', $4, $5, 0, null, null)
       on conflict (user_id, provider, account_email) do update set credentials_encrypted = excluded.credentials_encrypted, status = 'ok',
         granted_scopes = excluded.granted_scopes, next_sync_at = excluded.next_sync_at, error_count = 0, last_error = null, alert_sent_at = null, updated_at = $5
       returning id`,
      [userId, tokens.email, sealed, tokens.scope, now]);
    const { rows: [{ has_add_to, checked }] } = await client.query(
      "select exists (select 1 from calendars where user_id = $1 and is_add_to) as has_add_to, (select count(*)::int from calendars where user_id = $1 and check_conflicts and connection_id <> $2) as checked",
      [userId, conn.id]);
    // A new primary calendar is checked for conflicts, unless that would go over the plan's limit.
    let room = (await checkedCalendarLimit(client, userId)) - checked;
    for (const c of calendars) {
      const check = c.primary && room > 0;
      if (check) room--;
      const owner = c.accessRole === "owner";
      await client.query(
        `insert into calendars (connection_id, user_id, external_id, name, check_conflicts, is_add_to, access_role)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (connection_id, external_id) do update set name = excluded.name, access_role = excluded.access_role,
           is_add_to = calendars.is_add_to and excluded.access_role = 'owner', updated_at = now()`,
        [conn.id, userId, c.id, c.name, check, c.primary && owner && !has_add_to, c.accessRole]);
    }
    // Calendars the host no longer has in Google stop counting; their busy times go with them (cascade).
    await client.query("delete from calendars where connection_id = $1 and not (external_id = any($2::text[]))", [conn.id, calendars.map((c) => c.id)]);
    await client.query("commit");
    return conn.id as string;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** An access token for the connection, refreshed and re-sealed when it has less than a minute left. */
export async function accessTokenFor(pool: Db, google: GoogleClient, key: Buffer, connectionId: string, now = new Date()): Promise<string> {
  const { rows: [row] } = await pool.query("select user_id, account_email, credentials_encrypted from calendar_connections where id = $1", [connectionId]);
  if (!row) throw new GoogleApiError("Calendar connection no longer exists", { retryable: false, revoked: true });
  const aad = aadFor(row.user_id, row.account_email);
  const creds = unseal<Credentials>(key, row.credentials_encrypted, aad);
  if (creds.accessToken && creds.expiresAt && new Date(creds.expiresAt).getTime() - now.getTime() > 60_000) return creds.accessToken;
  const fresh = await google.refresh(creds.refreshToken, now);
  const next: Credentials = { ...creds, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt.toISOString() };
  await pool.query("update calendar_connections set credentials_encrypted = $2, updated_at = $3 where id = $1", [connectionId, seal(key, next, aad), now]);
  return fresh.accessToken;
}

/** Disconnects a host's own connection: asks Google to drop the grant, then deletes it with its calendars and busy times. */
export async function disconnectConnection(pool: Db, google: GoogleClient | null, key: Buffer | null, userId: string, connectionId: string): Promise<boolean> {
  const { rows: [row] } = await pool.query(
    "select user_id, account_email, credentials_encrypted from calendar_connections where id = $1 and user_id = $2", [connectionId, userId]);
  if (!row) return false;
  if (google && key && row.credentials_encrypted.length > 0) {
    // Stop the watch channels while the token still works; revoking it next would leave them pinging for up to a week.
    await stopConnectionChannels(pool, google, key, connectionId).catch(() => undefined);
    try {
      await google.revoke(unseal<Credentials>(key, row.credentials_encrypted, aadFor(row.user_id, row.account_email)).refreshToken);
    } catch {
      // A token that can't be opened can't be used either; deleting the row is what matters.
    }
  }
  await pool.query("delete from calendar_connections where id = $1 and user_id = $2", [connectionId, userId]);
  return true;
}

/**
 * Turns conflict checking on or off for one of the host's calendars. Turning one on fails (returns false) when the
 * host's plan already checks as many calendars as it allows; turning one off always works.
 */
export async function setCheckConflicts(pool: pg.Pool, userId: string, calendarId: string, on: boolean): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Two "on" toggles at once would each count before the other wrote; take turns per host.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`checked-calendars:${userId}`]);
    const limit = on ? await checkedCalendarLimit(client, userId) : Infinity;
    const { rowCount } = await client.query(
      `update calendars set check_conflicts = $3, updated_at = now() where id = $1 and user_id = $2
         and (not $3 or $4::int is null or (select count(*) from calendars o where o.user_id = $2 and o.check_conflicts and o.id <> $1) < $4::int)`,
      [calendarId, userId, on, Number.isFinite(limit) ? limit : null]);
    await client.query("commit");
    return Boolean(rowCount);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Makes one of the host's own calendars the one booked events go into. Only calendars they own qualify. */
export async function setAddToCalendar(pool: pg.Pool, userId: string, calendarId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rowCount } = await client.query("select 1 from calendars where id = $1 and user_id = $2 and access_role = 'owner' for update", [calendarId, userId]);
    if (!rowCount) {
      await client.query("rollback");
      return false;
    }
    await client.query("update calendars set is_add_to = false, updated_at = now() where user_id = $1 and is_add_to", [userId]);
    await client.query("update calendars set is_add_to = true, updated_at = now() where id = $1", [calendarId]);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
