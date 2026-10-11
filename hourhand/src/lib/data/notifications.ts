import type pg from "pg";

// Queueing booking emails. These run inside the same transaction as the booking change, so a booking and its emails
// commit together or not at all (the outbox pattern). The job runner (src/lib/jobs) sends the due rows.

/** Emails about one booking. */
export type BookingEmailKind =
  | "booked_guest" | "booked_host" | "reminder_guest"
  | "cancelled_guest" | "cancelled_host" | "rescheduled_guest" | "rescheduled_host" | "late_host";
/** Writes to the host's calendar (channel 'calendar'). */
export type CalendarJobKind = "calendar_create" | "calendar_move" | "calendar_delete";
/** A session package was paid: the buyer gets their booking link, the host hears about the sale. */
export type PackageEmailKind = "package_guest" | "package_host";
/** A GST invoice or credit note, emailed to the guest with a link to view and print it. */
export type InvoiceEmailKind = "invoice_guest";
/** Last month's earnings, to the host on the 1st. */
export type EarningsEmailKind = "earnings_host";
export type NotificationKind = BookingEmailKind | CalendarJobKind | PackageEmailKind | InvoiceEmailKind | EarningsEmailKind | "waitlist_guest" | "seat_invite" | "calendar_alert_host" | "renewal_reminder_host";

/** Guest reminders, in minutes before the start. A reminder whose time has already passed at booking is not queued. */
export const REMINDER_OFFSETS_MINUTES = [1440, 60] as const;

type Db = Pick<pg.PoolClient, "query">;
type Event = "booked" | "rescheduled" | "cancelled";

const MIN = 60_000;

/**
 * Queues the emails for one booking change. `notifyHost: false` is for a host closing their own account: their guests
 * hear about it, the host does not get one email per booking. `confirm: false` queues a booking's reminders and
 * calendar write but not its confirmations. Each row has a dedupe key, so queueing twice sends once.
 */
export async function queueBookingNotifications(db: Db, bookingId: string, event: Event, now: Date, { notifyHost = true, confirm = true } = {}): Promise<void> {
  const { rows } = await db.query(
    `select b.host_id, b.start_at, i.email as guest_email, i.guests::text[] as extra_guests, u.email as host_email,
       (select c.id from calendars c join calendar_connections cc on cc.id = c.connection_id
        where c.user_id = b.host_id and c.is_add_to and cc.status <> 'disconnected' and octet_length(cc.credentials_encrypted) > 0) as add_to_calendar,
       exists (select 1 from calendar_connections cc where cc.user_id = b.host_id) as has_calendar
     from bookings b join invitees i on i.booking_id = b.id join users u on u.id = b.host_id where b.id = $1`, [bookingId]);
  const b = rows[0];
  if (!b) return;
  const start = new Date(b.start_at);
  const queued: { kind: NotificationKind; channel: "email" | "calendar"; to: string; sendAt: Date; key: string }[] = [];
  const now_ = (kind: BookingEmailKind, to: string) => queued.push({ kind, channel: "email", to, sendAt: now, key: `booking:${bookingId}:${kind}` });
  // Extra guests get each guest email too, under their own keys (the worker leaves out the manage link for them).
  const extras: string[] = b.extra_guests ?? [];
  const toGuests = (kind: BookingEmailKind, sendAt: Date, key: string) => {
    queued.push({ kind, channel: "email", to: b.guest_email, sendAt, key });
    for (const g of extras) queued.push({ kind, channel: "email", to: g, sendAt, key: `${key}:to:${g.toLowerCase()}` });
  };
  // Calendar jobs name the target calendar; a delete finds the event's own calendar from the booking when it runs.
  const calendarJob = (kind: CalendarJobKind, calendarId: string) =>
    queued.push({ kind, channel: "calendar", to: calendarId, sendAt: now, key: `booking:${bookingId}:${kind}` });

  if (event === "cancelled") {
    // `confirm: false`: a later week cancelled along with an earlier one, whose email lists it.
    if (confirm) toGuests("cancelled_guest", now, `booking:${bookingId}:cancelled_guest`);
    if (confirm && notifyHost) now_("cancelled_host", b.host_email);
    await db.query(
      `update notifications set status = 'skipped', last_error = 'booking cancelled', updated_at = $2
       where booking_id = $1 and status = 'queued' and kind not in ('cancelled_guest', 'cancelled_host')
         and not (channel = 'calendar' and locked_until > $2)`, [bookingId, now]); // a running calendar write finishes; the delete waits for it
    if (b.has_calendar) calendarJob("calendar_delete", "event");
  } else {
    // `confirm: false` is a later week of a series: the first week's confirmation already lists it.
    if (confirm) { const k = event === "booked" ? "booked_guest" : "rescheduled_guest"; toGuests(k, now, `booking:${bookingId}:${k}`); }
    if (confirm && notifyHost) now_(event === "booked" ? "booked_host" : "rescheduled_host", b.host_email);
    if (event === "booked" && b.add_to_calendar) calendarJob("calendar_create", b.add_to_calendar);
    // A move updates the old booking's event wherever it is; with no old event it creates one in the add-to calendar.
    if (event === "rescheduled" && (b.add_to_calendar || b.has_calendar)) calendarJob("calendar_move", b.add_to_calendar ?? "event");
    for (const offset of REMINDER_OFFSETS_MINUTES) {
      const sendAt = new Date(start.getTime() - offset * MIN);
      if (sendAt > now) toGuests("reminder_guest", sendAt, `booking:${bookingId}:reminder_guest:${offset}`);
    }
  }

  for (const q of queued) {
    await db.query(
      `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
       values ($1, $2, $7, $3, $4, $5, $6) on conflict (dedupe_key) do nothing`,
      [bookingId, b.host_id, q.kind, q.to, q.sendAt, q.key, q.channel]);
  }
}
