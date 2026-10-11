import type pg from "pg";

export const RENEWAL_REMINDER_DAYS = 7;

/**
 * Queues the "renews in 7 days" email for every subscription renewing within the window. One per period: the dedupe key
 * carries the period end, and the worker checks again before sending that it is still the same, still renewing period.
 */
export async function queueRenewalReminders(db: Pick<pg.Pool, "query">, now = new Date()): Promise<number> {
  const { rowCount } = await db.query(
    `with due as (
       update subscriptions s set renewal_reminder_sent_at = $1
        where s.status = 'active' and not s.cancel_at_period_end and s.plan <> 'free' and s.provider_subscription_id is not null
          and s.renewal_reminder_sent_at is null
          and s.current_period_end > $1 and s.current_period_end <= $1::timestamptz + make_interval(days => $2)
       returning s.user_id, s.provider_subscription_id, s.current_period_end)
     insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
     select null, due.user_id, 'email', 'renewal_reminder_host', u.email, $1,
            'renewal:' || due.provider_subscription_id || ':' || (extract(epoch from due.current_period_end) * 1000)::bigint
       from due join users u on u.id = due.user_id and u.deleted_at is null
     on conflict (dedupe_key) do nothing`,
    [now, RENEWAL_REMINDER_DAYS]);
  return rowCount ?? 0;
}
