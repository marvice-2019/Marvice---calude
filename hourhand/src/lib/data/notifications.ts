import type pg from "pg";

// Queueing booking emails. These run inside the same transaction as the booking change, so a booking and its emails
// commit together or not at all (the outbox pattern). The job runner (src/lib/jobs) sends the due rows.

export type NotificationKind =
  | "booked_guest" | "booked_host" | "reminder_guest"
  | "cancelled_guest" | "cancelled_host" | "rescheduled_guest" | "rescheduled_host";

/** Guest reminders, in minutes before the start. A reminder whose time has already passed at booking is not queued. */
export const REMINDER_OFFSETS_MINUTES = [1440, 60] as const;

type Db = Pick<pg.PoolClient, "query">;
type Event = "booked" | "rescheduled" | "cancelled";

const MIN = 60_000;

/**
 * Queues the emails for one booking change. `notifyHost: false` is for a host closing their own account: their guests
 * hear about it, the host does not get one email per booking. Each row has a dedupe key, so queueing twice sends once.
 */
export async function queueBookingNotifications(db: Db, bookingId: string, event: Event, now: Date, { notifyHost = true } = {}): Promise<void> {
  const { rows } = await db.query(
    `select b.host_id, b.start_at, i.email as guest_email, u.email as host_email
     from bookings b join invitees i on i.booking_id = b.id join users u on u.id = b.host_id where b.id = $1`, [bookingId]);
  const b = rows[0];
  if (!b) return;
  const start = new Date(b.start_at);
  const queued: { kind: NotificationKind; to: string; sendAt: Date; key: string }[] = [];
  const now_ = (kind: NotificationKind, to: string) => queued.push({ kind, to, sendAt: now, key: `booking:${bookingId}:${kind}` });

  if (event === "cancelled") {
    now_("cancelled_guest", b.guest_email);
    if (notifyHost) now_("cancelled_host", b.host_email);
    await db.query(
      `update notifications set status = 'skipped', last_error = 'booking cancelled', updated_at = $2
       where booking_id = $1 and status = 'queued' and kind not in ('cancelled_guest', 'cancelled_host')`, [bookingId, now]);
  } else {
    now_(event === "booked" ? "booked_guest" : "rescheduled_guest", b.guest_email);
    if (notifyHost) now_(event === "booked" ? "booked_host" : "rescheduled_host", b.host_email);
    for (const offset of REMINDER_OFFSETS_MINUTES) {
      const sendAt = new Date(start.getTime() - offset * MIN);
      if (sendAt > now) queued.push({ kind: "reminder_guest", to: b.guest_email, sendAt, key: `booking:${bookingId}:reminder_guest:${offset}` });
    }
  }

  for (const q of queued) {
    await db.query(
      `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
       values ($1, $2, 'email', $3, $4, $5, $6) on conflict (dedupe_key) do nothing`,
      [bookingId, b.host_id, q.kind, q.to, q.sendAt, q.key]);
  }
}
