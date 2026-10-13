import type pg from "pg";
import { waNumber } from "../whatsapp";
import { whatsappConfig } from "../whatsapp-cloud";

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
/** The one WhatsApp reminder: a day ahead. Each message is paid for, and the email reminders still go. */
export const WHATSAPP_REMINDER_MINUTES = 1440;

type Db = Pick<pg.PoolClient, "query">;
type Event = "booked" | "rescheduled" | "cancelled";

const MIN = 60_000;

/**
 * Queues the emails for one booking change. `notifyHost: false` is for a host closing their own account: their guests
 * hear about it, the host does not get one email per booking. `confirm: false` queues a booking's reminders and
 * calendar write but not its confirmations. Each row has a dedupe key, so queueing twice sends once. The guest's
 * confirmation, day-ahead reminder and change notices also go on WhatsApp when they ticked it for their phone, haven't
 * replied STOP, and WhatsApp is set up here (`whatsapp`); whether the host's plan covers it is checked when it sends.
 */
export async function queueBookingNotifications(
  db: Db, bookingId: string, event: Event, now: Date,
  { notifyHost = true, confirm = true, whatsapp = whatsappConfig() !== null } = {},
): Promise<void> {
  const { rows } = await db.query(
    `select b.host_id, b.start_at, i.email as guest_email, i.guests::text[] as extra_guests, u.email as host_email,
       i.phone as guest_phone, i.whatsapp_opt_in_at is not null as whatsapp_opt_in,
       (select c.id from calendars c join calendar_connections cc on cc.id = c.connection_id
        where c.user_id = b.host_id and c.is_add_to and cc.status <> 'disconnected' and octet_length(cc.credentials_encrypted) > 0) as add_to_calendar,
       exists (select 1 from calendar_connections cc where cc.user_id = b.host_id) as has_calendar,
       b.external_event_id,
       -- Another live seat of the same group class: the class keeps one calendar event between all its seats.
       (select o.id from bookings o where b.class_key is not null and o.class_key = b.class_key and o.id <> b.id
          and (o.status = 'confirmed' or (o.status = 'pending_payment' and o.hold_expires_at > now()))
        order by (o.external_event_id is not null) desc, o.created_at limit 1) as class_mate
     from bookings b join invitees i on i.booking_id = b.id join users u on u.id = b.host_id where b.id = $1`, [bookingId]);
  const b = rows[0];
  if (!b) return;
  const start = new Date(b.start_at);
  const queued: { kind: NotificationKind; channel: "email" | "calendar" | "whatsapp"; to: string; sendAt: Date; key: string }[] = [];
  const phone = whatsapp && b.whatsapp_opt_in ? waNumber(b.guest_phone) : null;
  const optedOut = phone !== null && (await db.query("select 1 from whatsapp_opt_outs where phone = $1", [phone])).rowCount! > 0;
  const toWhatsApp = (kind: BookingEmailKind, sendAt: Date, suffix = "") => {
    if (phone && !optedOut) queued.push({ kind, channel: "whatsapp", to: phone, sendAt, key: `booking:${bookingId}:wa:${kind}${suffix}` });
  };
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
    if (confirm) toWhatsApp("cancelled_guest", now);
    if (confirm && notifyHost) now_("cancelled_host", b.host_email);
    await db.query(
      `update notifications set status = 'skipped', last_error = 'booking cancelled', updated_at = $2
       where booking_id = $1 and status = 'queued' and kind not in ('cancelled_guest', 'cancelled_host')
         and not (channel = 'calendar' and locked_until > $2)`, [bookingId, now]); // a running calendar write finishes; the delete waits for it
    if (b.class_mate) {
      // The class goes on: its calendar event stays, now on a remaining seat (or is written for it, if this seat's
      // event was never written).
      if (b.external_event_id) {
        await db.query(
          `update bookings m set external_event_id = s.external_event_id, external_calendar_id = s.external_calendar_id, join_url = coalesce(m.join_url, s.join_url), updated_at = $3
           from bookings s where m.id = $1 and s.id = $2 and m.external_event_id is null`, [b.class_mate, bookingId, now]);
      } else if (b.add_to_calendar) {
        await db.query(
          `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
           values ($1, $2, 'calendar', 'calendar_create', $3, $4, $5) on conflict (dedupe_key) do nothing`,
          [b.class_mate, b.host_id, b.add_to_calendar, now, `booking:${b.class_mate}:calendar_create`]);
      }
    } else if (b.has_calendar) calendarJob("calendar_delete", "event");
  } else {
    // `confirm: false` is a later week of a series: the first week's confirmation already lists it.
    if (confirm) { const k = event === "booked" ? "booked_guest" : "rescheduled_guest"; toGuests(k, now, `booking:${bookingId}:${k}`); toWhatsApp(k, now); }
    if (confirm && notifyHost) now_(event === "booked" ? "booked_host" : "rescheduled_host", b.host_email);
    if (event === "booked" && b.add_to_calendar && !b.class_mate) calendarJob("calendar_create", b.add_to_calendar);
    // A move updates the old booking's event wherever it is; with no old event it creates one in the add-to calendar.
    if (event === "rescheduled" && (b.add_to_calendar || b.has_calendar)) calendarJob("calendar_move", b.add_to_calendar ?? "event");
    for (const offset of REMINDER_OFFSETS_MINUTES) {
      const sendAt = new Date(start.getTime() - offset * MIN);
      if (sendAt > now) toGuests("reminder_guest", sendAt, `booking:${bookingId}:reminder_guest:${offset}`);
    }
    const waReminderAt = new Date(start.getTime() - WHATSAPP_REMINDER_MINUTES * MIN);
    if (waReminderAt > now) toWhatsApp("reminder_guest", waReminderAt, `:${WHATSAPP_REMINDER_MINUTES}`);
  }

  for (const q of queued) {
    await db.query(
      `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
       values ($1, $2, $7, $3, $4, $5, $6) on conflict (dedupe_key) do nothing`,
      [bookingId, b.host_id, q.kind, q.to, q.sendAt, q.key, q.channel]);
  }
}
