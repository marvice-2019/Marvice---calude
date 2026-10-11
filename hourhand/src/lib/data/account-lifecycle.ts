import type pg from "pg";

// Closing and purging accounts. No runtime imports on purpose: scripts/purge-deleted.ts runs this file under Node's
// own TypeScript support, and importing the app's modules from there would load them a second time under another name.

type Client = pg.PoolClient;

/**
 * Closes an account inside the caller's transaction: marks it deleted, turns its links off, signs out every device
 * and cancels upcoming bookings. Returns the cancelled booking ids, or null when there was no open account to close.
 */
export async function closeAccount(client: Client, userId: string, now: Date): Promise<string[] | null> {
  const { rowCount } = await client.query("update users set deleted_at = $2, updated_at = $2 where id = $1 and deleted_at is null", [userId, now]);
  if (!rowCount) return null;
  await client.query("update event_types set active = false where user_id = $1", [userId]);
  await client.query("delete from auth_sessions where user_id = $1", [userId]);
  const cancelled = await client.query(
    `update bookings set status = 'cancelled', cancelled_at = $2, cancelled_by = 'host', cancel_reason = 'The host closed their account'
     where host_id = $1 and status = 'confirmed' and start_at > $2 returning id`, [userId, now]);
  // Holds waiting on a guest's payment are released too. They never sent any email, so they aren't returned for one;
  // a payment that still lands is caught by the reconciler and refunded.
  await client.query(
    `update bookings set status = 'cancelled', cancelled_at = $2, cancelled_by = 'system', cancel_reason = 'The host closed their account', hold_expires_at = null
     where host_id = $1 and status = 'pending_payment'`, [userId, now]);
  return cancelled.rows.map((r) => r.id as string);
}

/** Permanently removes accounts closed more than 30 days before `now`. Everything a host owns cascades from users. */
export async function purgeClosedAccounts(client: Client, now: Date): Promise<number> {
  const { rows } = await client.query("select id from users where deleted_at < $1::timestamptz - interval '30 days' for update", [now]);
  const ids = rows.map((r) => r.id as string);
  if (ids.length === 0) return 0;
  await client.query("delete from users where id = any($1::uuid[])", [ids]);
  return ids.length;
}
