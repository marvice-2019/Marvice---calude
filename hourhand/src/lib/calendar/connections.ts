import type pg from "pg";
import { checkedCalendarLimit } from "../billing/account";
import { seal, unseal } from "../crypto/seal";
import { CalendarApiError, PROVIDER_NAMES, type CalendarEntry, type CalendarProviderId, type CalendarProviders, type OAuthCalendarProvider, type TokenSet } from "./provider";
import { stopConnectionChannels, watchCapable } from "./push";

// Stored calendar connections (Google, Microsoft, iCloud). Tokens are sealed with TOKEN_ENCRYPTION_KEY and bound to their connection, so neither a
// database dump nor a row copied into another account's connection can be used.

type Db = Pick<pg.Pool, "query">;
interface Credentials { refreshToken: string; accessToken: string | null; expiresAt: string | null }

/** The sealed credentials are bound to the account they belong to, not to a row id that isn't known before insert. */
const aadFor = (provider: string, userId: string, accountEmail: string) => `${provider}:${userId}:${accountEmail.toLowerCase()}`;

/**
 * Saves a new or renewed connection and its calendars. New connections check the primary calendar for conflicts
 * and use it for booked events, unless the host already has a calendar for booked events.
 */
export async function saveConnection(
  pool: pg.Pool, key: Buffer, userId: string, provider: CalendarProviderId, tokens: TokenSet, calendars: CalendarEntry[], now: Date,
): Promise<string> {
  if (!tokens.email) throw new Error(`${PROVIDER_NAMES[provider]} did not say which account was connected`);
  if (!tokens.refreshToken) throw new Error(`${PROVIDER_NAMES[provider]} did not return a refresh token`);
  const creds: Credentials = { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt.toISOString() };
  const sealed = seal(key, creds, aadFor(provider, userId, tokens.email));
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: [conn] } = await client.query(
      `insert into calendar_connections (user_id, provider, account_email, credentials_encrypted, status, granted_scopes, next_sync_at, error_count, last_error, alert_sent_at)
       values ($1, $6, $2, $3, 'ok', $4, $5, 0, null, null)
       on conflict (user_id, provider, account_email) do update set credentials_encrypted = excluded.credentials_encrypted, status = 'ok',
         granted_scopes = excluded.granted_scopes, next_sync_at = excluded.next_sync_at, error_count = 0, last_error = null, alert_sent_at = null, updated_at = $5
       returning id`,
      [userId, tokens.email, sealed, tokens.scope, now, provider]);
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
        `insert into calendars (connection_id, user_id, external_id, name, check_conflicts, is_add_to, access_role, can_teams)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (connection_id, external_id) do update set name = excluded.name, access_role = excluded.access_role,
           is_add_to = calendars.is_add_to and excluded.access_role = 'owner', can_teams = excluded.can_teams, updated_at = now()`,
        [conn.id, userId, c.id, c.name, check, c.primary && owner && !has_add_to, c.accessRole, c.teams ?? null]);
    }
    // Calendars the host no longer has in the account stop counting; their busy times go with them (cascade).
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
export async function accessTokenFor(pool: Db, providers: CalendarProviders, key: Buffer, connectionId: string, now = new Date()): Promise<string> {
  const read = async (db: Db) => {
    const { rows: [row] } = await db.query("select user_id, provider, account_email, credentials_encrypted from calendar_connections where id = $1", [connectionId]);
    if (!row) throw new CalendarApiError("Calendar connection no longer exists", { retryable: false, revoked: true });
    const providerId = row.provider as CalendarProviderId;
    const provider = providers[providerId];
    if (!provider) throw new CalendarApiError(`${PROVIDER_NAMES[providerId] ?? row.provider} calendars are not configured on this server`, { retryable: false });
    const aad = aadFor(row.provider, row.user_id, row.account_email);
    const sealed = row.credentials_encrypted as Buffer;
    const creds = unseal<Credentials>(key, sealed, aad);
    // iCloud has nothing to refresh: the Apple ID and the app-specific password (kept as the refresh token) are the credential.
    if (providerId === "icloud") return { provider, aad, sealed, creds: { ...creds, accessToken: `${row.account_email}:${creds.refreshToken}` }, valid: true };
    const valid = Boolean(creds.accessToken && creds.expiresAt && new Date(creds.expiresAt).getTime() - now.getTime() > 60_000);
    return { provider, aad, sealed, creds, valid };
  };
  const first = await read(pool);
  if (first.valid) return first.creds.accessToken as string;

  // Microsoft rotates refresh tokens and may refuse one that was already redeemed, so two callers refreshing at once could
  // disconnect a healthy connection or keep the older token. Refreshes take turns per connection; the lock is session-level
  // and needs one connection for lock, refresh and unlock, so a pool lends a dedicated client.
  const isPool = typeof (pool as Partial<pg.Pool>).connect === "function" && !("release" in pool);
  const client = isPool ? await (pool as pg.Pool).connect() : null;
  const db: Db = client ?? pool;
  const lockKey = [connectionId];
  let unlockError: Error | undefined;
  try {
    await db.query("select pg_advisory_lock(hashtext('cal-refresh:' || $1::text))", lockKey);
    try {
      // Whoever held the lock may have just refreshed.
      const { provider, aad, sealed, creds, valid } = await read(db);
      if (valid) return creds.accessToken as string;
      const fresh = await (provider as OAuthCalendarProvider).refresh(creds.refreshToken, now); // iCloud returned above
      const next: Credentials = { ...creds, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt.toISOString() };
      if (fresh.refreshToken) next.refreshToken = fresh.refreshToken;
      // A reconnect that saved new credentials meanwhile wins; this token still works for this call.
      await db.query("update calendar_connections set credentials_encrypted = $2, updated_at = $3 where id = $1 and credentials_encrypted = $4",
        [connectionId, seal(key, next, aad), now, sealed]);
      return fresh.accessToken;
    } finally {
      if (client) {
        // A connection that can't unlock is thrown away instead of going back to the pool, which ends its lock.
        await db.query("select pg_advisory_unlock(hashtext('cal-refresh:' || $1::text))", lockKey).catch((e: Error) => { unlockError = e; });
      } else {
        await db.query("select pg_advisory_unlock(hashtext('cal-refresh:' || $1::text))", lockKey);
      }
    }
  } finally {
    client?.release(unlockError);
  }
}

/** Disconnects a host's own connection: asks the provider to drop the grant, then deletes it with its calendars and busy times. */
export async function disconnectConnection(pool: Db, providers: CalendarProviders, key: Buffer | null, userId: string, connectionId: string): Promise<boolean> {
  const { rows: [row] } = await pool.query(
    "select user_id, provider, account_email, credentials_encrypted from calendar_connections where id = $1 and user_id = $2", [connectionId, userId]);
  if (!row) return false;
  const provider = providers[row.provider as CalendarProviderId];
  if (provider && key && row.credentials_encrypted.length > 0) {
    // Stop the watch channels while the token still works; revoking it next would leave them pinging for up to a week.
    if (row.provider === "google" && watchCapable(provider)) await stopConnectionChannels(pool, provider, key, connectionId).catch(() => undefined);
    // iCloud has no revoke: the host deletes the app-specific password at appleid.apple.com.
    if (provider.revoke) try {
      await provider.revoke(unseal<Credentials>(key, row.credentials_encrypted, aadFor(row.provider, row.user_id, row.account_email)).refreshToken);
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

/**
 * Connects iCloud with an Apple ID and app-specific password. Listing the calendars proves the password (Apple answers
 * 401 otherwise) before anything is stored; the password is kept sealed like a refresh token and never logged.
 */
export async function connectICloud(
  pool: pg.Pool, key: Buffer, provider: Pick<OAuthCalendarProvider, "listCalendars">, userId: string, appleId: string, password: string, now: Date,
): Promise<"ok" | "rejected" | "unreachable" | "no_calendars"> {
  const email = appleId.trim().toLowerCase();
  let calendars: CalendarEntry[];
  try {
    calendars = await provider.listCalendars(`${email}:${password}`);
  } catch (error) {
    return error instanceof CalendarApiError && error.revoked ? "rejected" : "unreachable";
  }
  if (calendars.length === 0) return "no_calendars";
  await saveConnection(pool, key, userId, "icloud", { accessToken: "", refreshToken: password, expiresAt: now, scope: "", email }, calendars, now);
  return "ok";
}
