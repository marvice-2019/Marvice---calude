import type pg from "pg";
import { accessTokenFor } from "../calendar/connections";
import type { GoogleClient } from "../calendar/google";
import { CalendarApiError, PROVIDER_NAMES, type CalendarProvider, type CalendarProviderId, type CalendarProviders } from "../calendar/provider";
import { recordConnectionFailure } from "../calendar/sync";
import type { BookingEmailKind, CalendarJobKind, NotificationKind } from "../data/notifications";
import type { InviteeAnswer, LocationKind } from "../data/types";
import type { HourCycle } from "../format";
import { GUEST_LOCATION_LABELS } from "../location-labels";
import { MailError, type Mailer } from "../mail/mailer";
import { invoiceById } from "../gst/invoices";
import { monthlyEarnings } from "../earnings";
import { renderBookingMail, renderCalendarAlert, renderEarningsMail, renderInvoiceMail, renderPackageMail, renderRenewalReminder, renderWaitlistMail, type BookingMailContext, type RenderedMail } from "../mail/templates";
import { PLAN_NAMES, PRICES, priceLine, type BillingInterval, type PaidPlan } from "../billing/plans";
import { freeSlots } from "../booking";
import { createPgStore } from "../data/pg-store";

// Runs due rows of the notifications queue: emails, and writes to the host's calendar (Google or Microsoft). Several workers can run
// at once: each claims rows with FOR UPDATE SKIP LOCKED and a lease (locked_until), so a row is never run by two
// workers, and a worker that dies mid-run frees its rows when the lease ends. Re-running a row is harmless: the
// notification id is Resend's idempotency key, and a calendar event's id is fixed per booking.

export const MAX_ATTEMPTS = 5;
/** Wait before attempt 2, 3, 4, 5. */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
const LEASE_MINUTES = 5;
/** Rows claimed per run. Each row's lease is renewed before it runs, so a slow batch can't outlive its lease. */
export const BATCH_SIZE = 10;
/** How long a guest's confirmation may wait for its video link (Google Meet or Teams) before it goes without it. */
export const MEET_LINK_WAIT_SECONDS = 180;
const VIDEO_LINK_WAIT = "waiting for the video link";
const DEFER_SECONDS = 20;
const MIN = 60_000;

/** `released`: emails a calendar write just unblocked, which are due now (the runner goes round again for them). */
export interface WorkerResult { claimed: number; sent: number; skipped: number; retrying: number; failed: number; deferred: number; released: number }
/** `pushAddress`: where Google sends change pings, or null when push can't work (no public https URL). */
/** `providers`: the calendar providers configured here. `google`: the Google client, for watch channels only. */
export interface CalendarDeps { providers: CalendarProviders; google?: GoogleClient; key: Buffer; pushAddress?: string | null }

interface Claimed { id: string; booking_id: string | null; user_id: string; kind: NotificationKind; channel: string; recipient: string; attempts: number; locked_until: Date; dedupe_key: string }

/** Claims up to `limit` due rows. Each claim counts as an attempt, so a row that keeps crashing its worker still runs out. */
export async function claimDue(pool: pg.Pool, now: Date, limit: number): Promise<Claimed[]> {
  const { rows } = await pool.query(
    `update notifications n set locked_until = $1::timestamptz + make_interval(mins => $3), attempts = n.attempts + 1, updated_at = $1
     from (select id from notifications
           where status = 'queued' and channel in ('email', 'calendar') and send_at <= $1 and (locked_until is null or locked_until < $1)
           order by send_at limit $2 for update skip locked) due
     where n.id = due.id
     returning n.id, n.booking_id, n.user_id, n.kind, n.channel, n.recipient, n.attempts, n.locked_until, n.dedupe_key`, [now, limit, LEASE_MINUTES]);
  return rows as Claimed[];
}

const CONTEXT = `
  select n.id as notification_id, n.created_at as queued_at, n.dedupe_key, b.id, b.host_id, b.series_id, b.status, b.start_at, b.end_at, b.cancelled_by, b.cancel_reason,
    b.location_kind as booking_location_kind, b.join_url, b.external_event_id, b.external_calendar_id,
    prev.start_at as previous_start_at, prev.external_event_id as previous_event_id, prev.external_calendar_id as previous_calendar_id,
    prev.join_url as previous_join_url, prev.cancelled_by as previous_cancelled_by,
    i.name as guest_name, i.email as guest_email, i.timezone as guest_timezone, i.answers, i.manage_token, i.reminders_opt_out, i.running_late_minutes,
    e.name as event_name, e.slug as event_slug, e.kind as event_kind, e.active as event_active, b.event_type_id, u.slug as host_slug,
    (select p.amount_minor from payments p where p.booking_id = b.id and p.status in ('paid', 'refund_pending', 'refunded')
      order by p.created_at desc limit 1) as paid_minor,
    (select p.kind from payments p where p.booking_id = b.id and p.status in ('paid', 'refund_pending', 'refunded')
      order by p.created_at desc limit 1) as paid_kind,
    coalesce(u.name, '') as host_name, u.email as host_email, u.timezone as host_timezone, u.time_format as host_time_format,
    loc.kind as location_kind, loc.value as location_value, atc.provider as add_to_provider, atc.can_teams as add_to_can_teams,
    -- a calendar write that hasn't been tried yet or is running right now; one waiting to retry doesn't hold emails back
    exists (select 1 from notifications cj where cj.booking_id = b.id and cj.channel = 'calendar' and cj.kind <> 'calendar_delete'
            and cj.status = 'queued' and (cj.attempts = 0 or cj.locked_until > $2)) as calendar_write_pending,
    exists (select 1 from notifications cj where cj.booking_id in (b.id, b.rescheduled_from_id) and cj.id <> n.id and cj.channel = 'calendar'
            and cj.status = 'queued' and cj.locked_until > $2) as calendar_write_in_flight
  from notifications n
  left join bookings b on b.id = n.booking_id
  left join invitees i on i.booking_id = b.id
  left join event_types e on e.id = b.event_type_id
  left join users u on u.id = b.host_id
  left join bookings prev on prev.id = b.rescheduled_from_id
  left join lateral (select kind, value from event_locations l where l.event_type_id = e.id order by position limit 1) loc on true
  -- the calendar the booking's event goes into: the old event's calendar when a move updates it, else the calendar job's target
  left join lateral (select cc.provider, c.can_teams from calendars c join calendar_connections cc on cc.id = c.connection_id
    where c.user_id = b.host_id and ((prev.external_event_id is not null and c.id = prev.external_calendar_id)
      or c.id::text = (select cj.recipient from notifications cj where cj.booking_id = b.id and cj.channel = 'calendar'
                       and cj.kind in ('calendar_create', 'calendar_move') order by cj.created_at desc limit 1))
    order by (prev.external_event_id is not null and c.id = prev.external_calendar_id) is true desc limit 1) atc on true
  where n.id = any($1::uuid[])`;

type ContextRow = Record<string, unknown>;

function toContext(r: ContextRow, baseUrl: string): BookingMailContext {
  return {
    bookingId: r.id as string, eventName: r.event_name as string,
    hostName: r.host_name as string, hostEmail: r.host_email as string, hostTimezone: r.host_timezone as string, hostTimeFormat: r.host_time_format as HourCycle,
    guestName: r.guest_name as string, guestEmail: r.guest_email as string, guestTimezone: r.guest_timezone as string,
    startAt: new Date(r.start_at as Date), endAt: new Date(r.end_at as Date),
    location: r.location_kind ? { kind: r.location_kind as LocationKind, value: (r.location_value as string | null) ?? null } : null,
    joinUrl: (r.join_url as string | null) ?? null,
    answers: (r.answers as InviteeAnswer[]) ?? [],
    cancelledBy: (r.cancelled_by as BookingMailContext["cancelledBy"]) ?? null, cancelReason: (r.cancel_reason as string | null) ?? null,
    paidMinor: (r.paid_minor as number | null) ?? null, paidIsDeposit: r.paid_kind === "deposit",
    previousStartAt: r.previous_start_at ? new Date(r.previous_start_at as Date) : null,
    movedBy: (r.previous_cancelled_by as BookingMailContext["movedBy"]) ?? null,
    issuedAt: new Date(r.queued_at as Date),
    manageUrl: `${baseUrl}/b/${r.manage_token as string}`, dashboardUrl: `${baseUrl}/dashboard/bookings/${r.id as string}`,
    // The minutes this email was queued for (in its key), not whatever the guest has tapped since.
    runningLateMinutes: Number(/:late:(\d+)/.exec(String(r.dedupe_key ?? ""))?.[1] ?? r.running_late_minutes) || null,
  };
}

const REBOOK_DAYS = 21;

/** Later weeks of the same series cancelled in the same transaction as this one (same cancelled_at). */
async function cancelledWith(pool: pg.Pool, bookingId: string): Promise<Date[]> {
  const { rows } = await pool.query(
    `select w.start_at from bookings b join bookings w on w.series_id = b.series_id and w.id <> b.id and w.cancelled_at = b.cancelled_at and w.series_index > b.series_index
     where b.id = $1 order by w.series_index`, [bookingId]);
  return rows.map((w) => new Date(w.start_at));
}

/** The weeks of a series still booked, read at send time, so a week cancelled before the confirmation went out isn't listed. */
async function seriesWeeks(pool: pg.Pool, seriesId: string, baseUrl: string): Promise<NonNullable<BookingMailContext["series"]>> {
  const { rows } = await pool.query(
    `select b.id, b.start_at, b.end_at, i.manage_token from bookings b join invitees i on i.booking_id = b.id
     where b.series_id = $1 and b.status = 'confirmed' order by b.series_index`, [seriesId]);
  return rows.map((w) => ({ bookingId: w.id, startAt: new Date(w.start_at), endAt: new Date(w.end_at), manageUrl: `${baseUrl}/b/${w.manage_token}` }));
}

/**
 * When the host cancels, the guest's email offers the three free times nearest the one that was cancelled, each opening
 * the booking page on that day. The window starts when the email was queued; the free times are read at send time.
 * None for a guest's own cancel, a one-off meeting (link only) or an event type that's switched off.
 */
async function rebookSuggestions(pool: pg.Pool, r: ContextRow, baseUrl: string): Promise<{ at: Date; url: string }[]> {
  if (r.cancelled_by !== "host" || r.event_kind === "one_off" || !r.event_active || !r.host_slug || !r.event_slug) return [];
  let host, eventType, slots: Date[];
  try {
    const store = createPgStore(pool);
    [host, eventType] = await Promise.all([store.getUser(r.host_id as string), store.getEventType(r.host_id as string, r.event_type_id as string)]);
    if (!host || !eventType) return [];
    const asOf = new Date(r.queued_at as Date);
    slots = await freeSlots(store, host, eventType, asOf, new Date(asOf.getTime() + REBOOK_DAYS * 86_400_000), asOf);
  } catch (error) {
    // Suggestions are a nicety: the cancellation itself must still reach the guest.
    console.error("rebook suggestions failed", { bookingId: r.id, error });
    return [];
  }
  const target = new Date(r.start_at as Date).getTime();
  // Not the time the host just cancelled: they can't make it.
  return slots.filter((s) => s.getTime() !== target).sort((a, b) => Math.abs(a.getTime() - target) - Math.abs(b.getTime() - target)).slice(0, 3)
    .sort((a, b) => a.getTime() - b.getTime())
    .map((at) => ({ at, url: `${baseUrl}/${host.slug}/${eventType.slug}?at=${encodeURIComponent(at.toISOString())}` }));
}

const isCalendarJob = (kind: NotificationKind): kind is CalendarJobKind => kind.startsWith("calendar_") && kind !== "calendar_alert_host";

/** Why a claimed row should not run any more, or null to run it. */
export function skipReason(kind: NotificationKind, r: ContextRow, now: Date): string | null {
  const start = new Date(r.start_at as Date);
  // Cancellation emails and removing the calendar event are the only things that still make sense for a cancelled booking.
  const forCancelled = kind === "cancelled_guest" || kind === "cancelled_host" || kind === "calendar_delete";
  if (!forCancelled && r.status !== "confirmed") return "booking cancelled";
  if (kind === "calendar_delete") return null;
  if (kind === "reminder_guest") {
    if (r.reminders_opt_out) return "guest opted out of reminders";
    if (start <= now) return "booking already started";
    return null;
  }
  // A guest may say they're late until 30 minutes after the start, which can be after a short meeting's end.
  if (kind === "late_host") return now.getTime() - start.getTime() > 60 * 60_000 ? "booking already over" : null;
  // Everything else is news about a booking; once the meeting is over it is no longer worth sending.
  if (new Date(r.end_at as Date) <= now) return "booking already over";
  return null;
}

/** Why a claimed row should wait a little before running, or null to run it now. */
export function deferReason(kind: NotificationKind, r: ContextRow, now: Date, calendarOn = true): string | null {
  // The guest's confirmation carries the video link, which exists once the host's calendar event is written. A Teams
  // link only comes from a Microsoft calendar that allows Teams meetings; otherwise there is none to wait for.
  const linkComing = r.booking_location_kind === "google_meet"
    || (r.booking_location_kind === "teams" && r.add_to_provider === "microsoft" && r.add_to_can_teams !== false);
  if (calendarOn && (kind === "booked_guest" || kind === "rescheduled_guest") && linkComing && !r.join_url && r.calendar_write_pending
      && now.getTime() - new Date(r.queued_at as Date).getTime() < MEET_LINK_WAIT_SECONDS * 1000) {
    return VIDEO_LINK_WAIT;
  }
  // Never delete or move an event while another worker may still be creating it.
  if ((kind === "calendar_delete" || kind === "calendar_move") && r.calendar_write_in_flight) return "another calendar write is running";
  return null;
}

/** Writes one booking change to the host's calendar. Returns the event id, or a reason to skip. */
async function runCalendarJob(pool: pg.Pool, deps: CalendarDeps, c: Claimed, r: ContextRow, baseUrl: string, now: Date): Promise<{ eventId: string } | { skip: string }> {
  const calendarRow = async (calendarId: unknown) => {
    if (typeof calendarId !== "string" || !/^[0-9a-f-]{36}$/i.test(calendarId)) return null;
    const { rows: [cal] } = await pool.query(
      `select c.external_id, c.connection_id, c.can_teams, cc.provider from calendars c join calendar_connections cc on cc.id = c.connection_id
       where c.id = $1 and c.user_id = $2 and cc.status <> 'disconnected'`, [calendarId, r.host_id]);
    return cal ? {
      externalId: cal.external_id as string, connectionId: cal.connection_id as string, providerId: cal.provider as CalendarProviderId,
      canTeams: cal.can_teams === true,
    } : null;
  };
  /** The provider for a calendar's connection, or a reason to skip when that provider isn't configured here. */
  const providerOf = (cal: { providerId: CalendarProviderId }): CalendarProvider | { skip: string } =>
    deps.providers[cal.providerId] ?? { skip: `${PROVIDER_NAMES[cal.providerId] ?? cal.providerId} calendars are not configured on this server` };
  const kind = c.kind as CalendarJobKind;
  const ctx = toContext(r, baseUrl);
  const where = ctx.location && ctx.location.kind !== "google_meet" && ctx.location.kind !== "teams"
    ? (ctx.location.value ? `${GUEST_LOCATION_LABELS[ctx.location.kind]}: ${ctx.location.value}` : GUEST_LOCATION_LABELS[ctx.location.kind]) : null;
  const summary = `${ctx.eventName} with ${ctx.guestName}`;

  let connectionId: string | null = null;
  try {
    if (kind === "calendar_delete") {
      const cal = await calendarRow(r.external_calendar_id);
      if (!r.external_event_id || !cal) return { skip: "no calendar event to remove" };
      connectionId = cal.connectionId;
      const provider = providerOf(cal);
      if ("skip" in provider) return provider;
      await provider.deleteEvent(await accessTokenFor(pool, deps.providers, deps.key, cal.connectionId, now), cal.externalId, r.external_event_id as string);
      return { eventId: r.external_event_id as string };
    }

    if (kind === "calendar_move" && r.previous_event_id) {
      const cal = await calendarRow(r.previous_calendar_id);
      if (cal) {
        connectionId = cal.connectionId;
        const provider = providerOf(cal);
        if ("skip" in provider) return provider;
        const token = await accessTokenFor(pool, deps.providers, deps.key, cal.connectionId, now);
        const moved = await provider.moveEvent(token, cal.externalId, r.previous_event_id as string, ctx.startAt, ctx.endAt, ctx.hostTimezone, summary);
        await pool.query("update bookings set external_event_id = $2, external_calendar_id = $3, join_url = $4, updated_at = now() where id = $1",
          [r.id, moved.id, r.previous_calendar_id, moved.joinUrl ?? r.previous_join_url ?? null]);
        return { eventId: moved.id };
      }
    }

    // A new booking, or a move whose old booking never got an event: create one in the chosen calendar.
    const cal = await calendarRow(c.recipient);
    if (!cal) return { skip: "no calendar to add the event to" };
    connectionId = cal.connectionId;
    const provider = providerOf(cal);
    if ("skip" in provider) return provider;
    const token = await accessTokenFor(pool, deps.providers, deps.key, cal.connectionId, now);
    const description = [
      `Booked through Hourhand by ${ctx.guestName} <${ctx.guestEmail}>, time zone ${ctx.guestTimezone}.`,
      ...ctx.answers.filter((a) => a.answer.trim()).map((a) => `${a.label}: ${a.answer}`),
      "", `Details: ${ctx.dashboardUrl}`,
    ].join("\n");
    // Only a calendar that allows Teams meetings can make one; asking any other (e.g. a personal Outlook account) can fail the whole write.
    const conference = r.booking_location_kind === "google_meet" ? "google_meet" : r.booking_location_kind === "teams" && cal.canTeams ? "teams" : null;
    let event = await provider.insertEvent(token, cal.externalId, {
      summary, description, start: ctx.startAt, end: ctx.endAt, timeZone: ctx.hostTimezone, location: where,
      attendee: { email: ctx.guestEmail, name: ctx.guestName }, conference, bookingId: ctx.bookingId,
    });
    // Meet and Teams links can be created asynchronously; give the provider a moment so the guest's confirmation can carry the link.
    for (let i = 0; i < 3 && event.conferencePending; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      event = await provider.getEvent(token, cal.externalId, event.id);
    }
    await pool.query("update bookings set external_event_id = $2, external_calendar_id = $3, join_url = coalesce($4, join_url), updated_at = now() where id = $1",
      [r.id, event.id, c.recipient, event.joinUrl]);
    return { eventId: event.id };
  } catch (error) {
    // A revoked grant or missing permission disconnects the connection (and tells the host) right away.
    if (connectionId && error instanceof CalendarApiError && error.revoked) await recordConnectionFailure(pool, connectionId, error, now);
    throw error;
  }
}

async function renderAlert(pool: pg.Pool, c: Claimed, baseUrl: string): Promise<RenderedMail | { skip: string }> {
  const connectionId = /^calendar:([0-9a-f-]{36}):alert:/.exec(c.dedupe_key)?.[1];
  const { rows: [conn] } = connectionId
    ? await pool.query("select account_email, status, last_error from calendar_connections where id = $1", [connectionId])
    : { rows: [] };
  if (!conn) return { skip: "calendar connection removed" };
  if (conn.status === "ok") return { skip: "calendar connection recovered" };
  return renderCalendarAlert({ accountEmail: conn.account_email, disconnected: conn.status === "disconnected", lastError: conn.last_error, calendarsUrl: `${baseUrl}/dashboard/calendars` });
}

/** The renewal reminder goes only if that same period is still about to renew: not after a cancel, pause or renewal. */
async function renderRenewal(pool: pg.Pool, c: Claimed, baseUrl: string): Promise<RenderedMail | { skip: string }> {
  const m = /^renewal:([^:]+):(\d+)$/.exec(c.dedupe_key);
  const { rows: [s] } = await pool.query(
    `select s.plan, s.interval, s.provider, s.provider_subscription_id, s.status, s.current_period_end, s.cancel_at_period_end, u.timezone
       from subscriptions s join users u on u.id = s.user_id where s.user_id = $1`,
    [c.user_id]);
  if (!m || !s || s.provider_subscription_id !== m[1]) return { skip: "subscription changed" };
  if (s.status !== "active" || s.cancel_at_period_end) return { skip: "subscription no longer renewing" };
  if (!s.current_period_end || s.current_period_end.getTime() !== Number(m[2])) return { skip: "period already renewed" };
  if (!(s.plan in PRICES)) return { skip: "not a paid plan" };
  return renderRenewalReminder({
    planName: PLAN_NAMES[s.plan as PaidPlan], price: priceLine(s.plan as PaidPlan, s.interval as BillingInterval, s.provider === "stripe" ? "USD" : "INR"),
    renewsOn: s.current_period_end, timezone: s.timezone, planUrl: `${baseUrl}/dashboard/plan`,
  });
}

async function renderEarnings(pool: pg.Pool, c: Claimed, baseUrl: string, now: Date): Promise<RenderedMail | { skip: string }> {
  const m = /^earnings:[0-9a-f-]{36}:(\d{4}-\d{2})$/.exec(c.dedupe_key);
  const e = m ? await monthlyEarnings(pool, c.user_id, m[1], now) : null;
  if (!e) return { skip: "no report" };
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${e.month}-01T00:00:00Z`));
  return renderEarningsMail({ monthLabel, netMinor: e.netMinor, bookingsMinor: e.bookingsMinor, packagesMinor: e.packagesMinor, refundsMinor: e.refundsMinor,
    sessionsHeld: e.sessions.held, noShows: e.sessions.noShows, url: `${baseUrl}/dashboard/earnings?month=${e.month}` });
}

/** A time opened on a day the guest waited for. The booking is the cancelled one; its start is the freed time. */
async function renderWaitlist(pool: pg.Pool, c: Claimed, baseUrl: string, now: Date): Promise<RenderedMail | { skip: string }> {
  const m = /^waitlist:([0-9a-f-]{36})$/.exec(c.dedupe_key);
  if (!m) return { skip: "not a waitlist email" };
  const { rows: [w] } = await pool.query(
    `select w.name, w.timezone, b.start_at, e.name as event_name, e.slug as event_slug, e.active, u.name as host_name, u.slug as host_slug, u.deleted_at
     from waitlist w join bookings b on b.id = $2 join event_types e on e.id = w.event_type_id join users u on u.id = w.host_id where w.id = $1`, [m[1], c.booking_id]);
  if (!w) return { skip: "waitlist entry gone" };
  if (new Date(w.start_at).getTime() <= now.getTime()) return { skip: "the time has passed" };
  if (!w.active || w.deleted_at || !w.host_slug) return { skip: "event no longer bookable" };
  const start = new Date(w.start_at);
  return renderWaitlistMail({ guestName: w.name, hostName: w.host_name, eventName: w.event_name, start, timezone: w.timezone,
    url: `${baseUrl}/${w.host_slug}/${w.event_slug}?at=${encodeURIComponent(start.toISOString())}` });
}

async function renderInvoice(pool: pg.Pool, c: Claimed, baseUrl: string): Promise<RenderedMail | { skip: string }> {
  const m = /^invoice:([0-9a-f-]{36})$/.exec(c.dedupe_key);
  const v = m ? await invoiceById(pool, m[1]) : null;
  if (!v) return { skip: "invoice not found" };
  const { rows: [u] } = await pool.query("select email from users where id = $1", [v.hostId]);
  return renderInvoiceMail({ kind: v.kind, number: v.number, supplierName: v.supplier.legalName, supplierEmail: u?.email ?? "", totalMinor: v.totalMinor,
    description: v.description, url: `${baseUrl}/invoice/${v.token}`, originalNumber: v.originalNumber });
}

async function renderPackage(pool: pg.Pool, c: Claimed, baseUrl: string): Promise<RenderedMail | { skip: string }> {
  const m = /^purchase:([0-9a-f-]{36}):package_(guest|host)$/.exec(c.dedupe_key);
  if (!m) return { skip: "not a package email" };
  const { rows: [p] } = await pool.query(
    `select p.guest_name, p.guest_email, p.sessions, p.price_minor, p.expires_at, p.token, p.status, k.name as package_name, e.name as event_name,
       u.name as host_name, u.email as host_email, u.timezone
     from package_purchases p join packages k on k.id = p.package_id join event_types e on e.id = p.event_type_id join users u on u.id = p.host_id
     where p.id = $1`, [m[1]]);
  if (!p || p.status !== "paid") return { skip: "package not paid" };
  return renderPackageMail(c.kind as "package_guest" | "package_host", {
    hostName: p.host_name, hostEmail: p.host_email, guestName: p.guest_name, guestEmail: p.guest_email, packageName: p.package_name, eventName: p.event_name,
    sessions: p.sessions, priceMinor: p.price_minor, expiresAt: p.expires_at, timezone: p.timezone,
    buyerUrl: `${baseUrl}/p/${p.token}`, dashboardUrl: `${baseUrl}/dashboard/packages`,
  });
}

export async function processDueNotifications(
  pool: pg.Pool, mailer: Mailer, opts: { baseUrl: string; now?: Date; limit?: number; calendar?: CalendarDeps | null },
): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const claimed = await claimDue(pool, now, opts.limit ?? BATCH_SIZE);
  const result: WorkerResult = { claimed: claimed.length, sent: 0, skipped: 0, retrying: 0, failed: 0, deferred: 0, released: 0 };
  if (claimed.length === 0) return result;

  const { rows } = await pool.query(CONTEXT, [claimed.map((c) => c.id), now]);
  const contexts = new Map(rows.map((r) => [r.notification_id as string, r as ContextRow]));

  // Every write checks the lease, so a worker whose lease ran out can't overwrite the next worker's result.
  const finish = (c: Claimed, status: "sent" | "skipped" | "failed", fields: { providerId?: string; error?: string }) =>
    pool.query(
      `update notifications set status = $3, provider_message_id = coalesce($4, provider_message_id), last_error = $5,
         sent_at = case when $3 = 'sent' then $6::timestamptz else sent_at end, locked_until = null, updated_at = $6
       where id = $1 and locked_until = $2`,
      [c.id, c.locked_until, status, fields.providerId ?? null, fields.error ?? null, now]);
  const skip = async (c: Claimed, reason: string) => {
    await finish(c, "skipped", { error: reason });
    result.skipped++;
  };
  // Once a calendar write has run, whatever the outcome, a guest confirmation waiting for its video link goes at once:
  // with the link if the write worked, without it if not. It never waits on a calendar that may take hours to recover.
  const release = async (c: Claimed) => {
    if (c.kind !== "calendar_create" && c.kind !== "calendar_move") return;
    const woken = await pool.query(
      "update notifications set send_at = $2, last_error = null where booking_id = $1 and status = 'queued' and kind in ('booked_guest', 'rescheduled_guest') and send_at > $2",
      [c.booking_id, now]);
    result.released += woken.rowCount ?? 0;
  };

  for (const c of claimed) {
    const r = contexts.get(c.id)!;
    if (c.attempts > MAX_ATTEMPTS) {
      await finish(c, "failed", { error: `gave up after ${MAX_ATTEMPTS} attempts (the worker stopped during the last one)` });
      result.failed++;
      continue;
    }
    // Host emails about their account rather than a booking.
    const isAccountMail = c.kind === "calendar_alert_host" || c.kind === "renewal_reminder_host" || c.kind === "package_guest" || c.kind === "package_host" || c.kind === "invoice_guest" || c.kind === "earnings_host" || c.kind === "waitlist_guest";
    if (!isAccountMail) {
      if (!r?.id) { await skip(c, "booking no longer exists"); continue; }
      const why = skipReason(c.kind, r, now);
      if (why) { await skip(c, why); continue; }
      let wait = deferReason(c.kind, r, now, Boolean(opts.calendar));
      if (wait === VIDEO_LINK_WAIT) {
        // The calendar write may have finished earlier in this same batch: look again before waiting.
        const { rows: [fresh] } = await pool.query(
          `select b.join_url, exists (select 1 from notifications cj where cj.booking_id = b.id and cj.channel = 'calendar'
             and cj.kind <> 'calendar_delete' and cj.status = 'queued' and (cj.attempts = 0 or cj.locked_until > $2)) as pending
           from bookings b where b.id = $1`, [r.id, now]);
        r.join_url = fresh.join_url;
        r.calendar_write_pending = fresh.pending;
        wait = deferReason(c.kind, r, now, Boolean(opts.calendar));
      }
      if (wait) {
        // Not an attempt: hand the row back for a little later.
        await pool.query("update notifications set send_at = $3, attempts = attempts - 1, locked_until = null, last_error = $4 where id = $1 and locked_until = $2",
          [c.id, c.locked_until, new Date(now.getTime() + DEFER_SECONDS * 1000), wait]);
        result.deferred++;
        continue;
      }
    }
    if (isCalendarJob(c.kind) && !opts.calendar) { await skip(c, `${Object.values(PROVIDER_NAMES).join(" and ")} calendars are not configured on this server`); await release(c); continue; }

    // Renew the lease for this row only, right before running it. If another worker took the row over, leave it to them.
    const renewed = await pool.query(
      "update notifications set locked_until = $3 where id = $1 and locked_until = $2 returning locked_until",
      [c.id, c.locked_until, new Date(Math.max(now.getTime(), Date.now()) + LEASE_MINUTES * MIN)]);
    if (!renewed.rowCount) continue;
    c.locked_until = renewed.rows[0].locked_until as Date;

    let providerId: string;
    try {
      if (isCalendarJob(c.kind)) {
        const out = await runCalendarJob(pool, opts.calendar!, c, r, opts.baseUrl, now);
        if ("skip" in out) { await skip(c, out.skip); await release(c); continue; }
        providerId = out.eventId;
      } else {
        const mail = c.kind === "calendar_alert_host" ? await renderAlert(pool, c, opts.baseUrl)
          : c.kind === "renewal_reminder_host" ? await renderRenewal(pool, c, opts.baseUrl)
          : c.kind === "package_guest" || c.kind === "package_host" ? await renderPackage(pool, c, opts.baseUrl)
          : c.kind === "invoice_guest" ? await renderInvoice(pool, c, opts.baseUrl)
          : c.kind === "earnings_host" ? await renderEarnings(pool, c, opts.baseUrl, now)
          : c.kind === "waitlist_guest" ? await renderWaitlist(pool, c, opts.baseUrl, now)
          : renderBookingMail(c.kind as BookingEmailKind, {
            ...toContext(r, opts.baseUrl),
            ...(c.kind === "cancelled_guest" ? { rebook: await rebookSuggestions(pool, r, opts.baseUrl) } : {}),
            ...((c.kind === "booked_guest" || c.kind === "booked_host") && r.series_id === r.id ? { series: await seriesWeeks(pool, r.id as string, opts.baseUrl) } : {}),
            ...((c.kind === "cancelled_guest" || c.kind === "cancelled_host") && r.series_id ? { alsoCancelled: await cancelledWith(pool, r.id as string) } : {}),
          });
        if ("skip" in mail) { await skip(c, mail.skip); continue; }
        ({ id: providerId } = await mailer.send({ ...mail, to: c.recipient, idempotencyKey: `notification-${c.id}` }));
      }
    } catch (error) {
      const retryable = error instanceof MailError || error instanceof CalendarApiError ? error.retryable : true;
      const message = (error as Error).message.slice(0, 500);
      if (!retryable || c.attempts >= MAX_ATTEMPTS) {
        await finish(c, "failed", { error: message });
        result.failed++;
        console.error(`[jobs] notification ${c.id} (${c.kind}) failed for good: ${message}`);
      } else {
        const delay = RETRY_DELAYS_MINUTES[Math.min(c.attempts, RETRY_DELAYS_MINUTES.length) - 1];
        await pool.query(
          "update notifications set send_at = $3, last_error = $4, locked_until = null, updated_at = $5 where id = $1 and locked_until = $2",
          [c.id, c.locked_until, new Date(now.getTime() + delay * MIN), message, now]);
        result.retrying++;
        console.warn(`[jobs] notification ${c.id} (${c.kind}) attempt ${c.attempts} failed, retrying in ${delay} min: ${message}`);
      }
      await release(c);
      continue;
    }
    // Recorded outside the try: a database error here must not be mistaken for a failed send and retried.
    await finish(c, "sent", { providerId });
    result.sent++;
    await release(c);
  }
  return result;
}
