import type pg from "pg";
import { computeOneOffSlots, computeSlots, isSyncStale } from "./slots";
import { isNamedError, type Booking, type DataStore, type EventType, type LinkUnavailableError, type User } from "./data/types";
import { BOOKING_LIMITS, type createRateLimiter } from "./rate-limit";
import type { Plan } from "./billing/plans";
import { startPaidBooking } from "./payments/booking-payments";
import type { HostRazorpayAuth } from "./payments/host-razorpay";
import type { RazorpayOrders } from "./payments/razorpay-orders";

const MIN = 60_000;
const DAY = 86_400_000;
const MAX_RANGE_DAYS = 62;

export type HandlerResult = { status: number; body: unknown };

export function isIanaTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Free slot starts for one public event type, using everything the engine needs from the store.
 * `movingId` is a booking being rescheduled: its own time doesn't block the slots it could move to.
 */
export async function freeSlots(store: DataStore, host: User, eventType: EventType, from: Date, to: Date, now: Date, movingId: string | null = null): Promise<Date[]> {
  if (eventType.kind === "one_off") {
    const [times, connections, busyBlocks, bookings] = await Promise.all([
      store.listOneOffTimes(eventType.id),
      store.listCalendarConnections(host.id),
      store.listBusyBlocks(host.id, new Date(from.getTime() - DAY), new Date(to.getTime() + DAY)),
      store.listBookings(host.id),
    ]);
    return computeOneOffSlots({
      times, durationMinutes: eventType.durationMinutes, busyBlocks, bookings: bookings.filter((b) => b.id !== movingId),
      now, rangeStart: from, rangeEnd: to, syncStale: isSyncStale(connections, now),
    });
  }
  const [{ schedule, rules }, connections, busyBlocks, bookings] = await Promise.all([
    store.getDefaultSchedule(host.id),
    store.listCalendarConnections(host.id),
    store.listBusyBlocks(host.id, new Date(from.getTime() - DAY), new Date(to.getTime() + DAY)),
    store.listBookings(host.id),
  ]);
  return computeSlots({
    eventType, schedule, rules, busyBlocks, bookings: bookings.filter((b) => b.id !== movingId), now, rangeStart: from, rangeEnd: to,
    syncStale: isSyncStale(connections, now),
  });
}

type Target = { host: User; eventType: EventType; linkToken: string | null };

/**
 * The host and event type a public request is for: a single-use link (`linkToken`), or the public slug pair. A one-off
 * meeting has no public slug pair (getPublicEventType leaves it out), so it is reachable only by its link. A link that
 * isn't open answers with its state and nothing about the host.
 */
async function resolveTarget(store: DataStore, slug: string, event: string, linkToken: string | null, now: Date, idempotencyKey?: string): Promise<Target | HandlerResult> {
  if (linkToken) {
    const r = await store.resolveBookingLink(linkToken, now, { idempotencyKey });
    if (r.status !== "open") return linkRefusal(r.status);
    return { host: r.host, eventType: r.eventType, linkToken };
  }
  const found = await store.getPublicEventType(slug, event);
  return found ? { ...found, linkToken: null } : { status: 404, body: { error: "not_found" } };
}

const isResult = (t: Target | HandlerResult): t is HandlerResult => "status" in t;

/** A booking's own host and event type, when they match the slug pair asked for. */
async function bookingTarget(store: DataStore, booking: Booking, slug: string, event: string): Promise<Target | null> {
  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  return host && eventType && host.slug === slug && eventType.slug === event ? { host, eventType, linkToken: null } : null;
}

/** used → 409 (someone booked it), unknown → 404, expired or revoked → 410 (it existed and is gone). */
function linkRefusal(status: "used" | "expired" | "revoked" | "not_found"): HandlerResult {
  return { status: status === "used" ? 409 : status === "not_found" ? 404 : 410, body: { error: `link_${status}` } };
}

/**
 * GET /api/slots?slug=&event=&from=&to=&tz=&token=   (or ?link=<single-use link token> instead of slug and event)
 * `token` is an optional manage token: when it names a confirmed booking for this host and event,
 * that booking's own time doesn't hide slots. Any other token is ignored.
 */
export async function handleGetSlots(store: DataStore, params: URLSearchParams, now: Date): Promise<HandlerResult> {
  const errors: Record<string, string> = {};
  const slug = params.get("slug") ?? "";
  const event = params.get("event") ?? "";
  const link = params.get("link") || null;
  const from = parseInstant(params.get("from"));
  const to = parseInstant(params.get("to"));
  const tz = params.get("tz");
  if (!link && !slug) errors.slug = "Required.";
  if (!link && !event) errors.event = "Required.";
  if (!from) errors.from = "Must be an ISO date-time.";
  if (!to) errors.to = "Must be an ISO date-time.";
  if (from && to && (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY)) {
    errors.to = `Must be after from, at most ${MAX_RANGE_DAYS} days later.`;
  }
  if (tz !== null && !isIanaTimeZone(tz)) errors.tz = "Must be an IANA time zone.";
  if (Object.keys(errors).length > 0 || !from || !to) return { status: 400, body: { error: "invalid_request", fields: errors } };

  const token = params.get("token");
  const moving = token ? await store.getBookingByManageToken(token) : null;
  // Rescheduling from the manage link: the booking's own event type, so a one-off meeting (no public slug pair) still
  // lists its remaining times. Only when the request names that same host and event, as the manage page does.
  const own = !link && moving && moving.status === "confirmed" ? await bookingTarget(store, moving, slug, event) : null;
  const found = own ?? await resolveTarget(store, slug, event, link, now);
  if (isResult(found)) return found;
  const movingId = moving && moving.status === "confirmed" && moving.hostId === found.host.id && moving.eventTypeId === found.eventType.id ? moving.id : null;
  const slots = await freeSlots(store, found.host, found.eventType, from, to, now, movingId);
  return { status: 200, body: { timezone: tz ?? found.host.timezone, slots: slots.map((s) => s.toISOString()) } };
}

export interface BookingRequest {
  slug: string;
  event: string;
  /** A single-use link's token; when set, slug and event aren't needed. */
  linkToken: string | null;
  start: Date;
  name: string;
  email: string;
  timezone: string;
  phone: string | null;
  answers: Record<string, string>;
  idempotencyKey: string;
}

export type Validation = { ok: true; value: BookingRequest } | { ok: false; fields: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shape checks only. Whether `start` is still offered is checked against the engine in handleCreateBooking. */
export function validateBookingRequest(input: unknown): Validation {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");

  const name = str("name");
  const email = str("email");
  const phone = str("phone");
  const start = parseInstant(body.start);
  const idempotencyKey = str("idempotencyKey");
  const linkToken = str("linkToken");
  if (linkToken.length > 100) fields.linkToken = "That link isn't valid.";
  if (!linkToken && !str("slug")) fields.slug = "Required.";
  if (!linkToken && !str("event")) fields.event = "Required.";
  if (!start) fields.start = "Pick a time.";
  if (name.length < 1 || name.length > 100) fields.name = "Enter your name (up to 100 characters).";
  if (!EMAIL.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  if (!isIanaTimeZone(body.timezone)) fields.timezone = "Pick a valid time zone.";
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) fields.phone = "Enter a phone number with country code, like +91 98765 43210.";
  if (!idempotencyKey) fields.idempotencyKey = "Missing request key.";
  else if (idempotencyKey.length < 8 || idempotencyKey.length > 100) fields.idempotencyKey = "Request key must be 8–100 characters.";

  const answers: Record<string, string> = {};
  if (body.answers !== undefined) {
    if (typeof body.answers !== "object" || body.answers === null || Array.isArray(body.answers)) {
      fields.answers = "Answers must be an object.";
    } else {
      for (const [k, v] of Object.entries(body.answers)) {
        if (typeof v !== "string" || v.length > 2000) fields[`answers.${k}`] = "Keep answers under 2000 characters.";
        else answers[k] = v.trim();
      }
    }
  }

  if (Object.keys(fields).length > 0 || !start) return { ok: false, fields };
  return {
    ok: true,
    value: { slug: str("slug"), event: str("event"), linkToken: linkToken || null, start, name, email, timezone: body.timezone as string, phone: phone || null, answers, idempotencyKey },
  };
}

/** The 409 a guest sees when their time is gone, with the next three open times after it. */
export async function slotTaken(store: DataStore, host: User, eventType: EventType, after: Date, now: Date, movingId: string | null = null): Promise<HandlerResult> {
  const windowEnd = new Date(now.getTime() + eventType.bookingWindowDays * DAY);
  const slots = await freeSlots(store, host, eventType, now, windowEnd, now, movingId);
  const later = slots.filter((s) => s >= after);
  const nextSlots = (later.length > 0 ? later : slots).slice(0, 3).map((s) => s.toISOString());
  return { status: 409, body: { error: "slot_taken", nextSlots } };
}

type Limiter = Pick<ReturnType<typeof createRateLimiter>, "take">;

/** How a priced booking reaches its host's Razorpay and plan. Injected so tests can use fakes; null where payments aren't set up. */
export interface PaymentDeps {
  pool: pg.Pool;
  authFor(hostId: string): Promise<HostRazorpayAuth | null>;
  ordersFor(auth: HostRazorpayAuth): RazorpayOrders;
  planFor(hostId: string): Promise<Plan>;
}

/**
 * POST /api/bookings. With `limit`, new bookings are rate limited per client address (see clientIp) and per guest
 * email; the route always passes it, unit tests of the booking rules leave it out. A priced event also needs `payments`:
 * its booking is held as pending_payment and the response carries what Razorpay Checkout needs.
 */
export async function handleCreateBooking(
  store: DataStore, input: unknown, now: Date, limit?: { clientKey: string; limiter: Limiter }, payments?: PaymentDeps | null,
): Promise<HandlerResult> {
  const v = validateBookingRequest(input);
  if (!v.ok) return { status: 400, body: { error: "invalid_request", fields: v.fields } };
  const req = v.value;

  const found = await resolveTarget(store, req.slug, req.event, req.linkToken, now, req.idempotencyKey);
  if (isResult(found)) return found;
  const { host, eventType } = found;

  // A repeated submit returns the booking it already made, before the slot re-check (which it would now fail).
  const existing = (await store.listBookings(host.id)).find((b) => b.idempotencyKey === req.idempotencyKey);
  const priceMinor = eventType.priceMinor;
  // A priced repeat goes through startPaidBooking below instead, so a still-held booking gets its payment details back.
  if (existing && !priceMinor) return { status: 200, body: { bookingId: existing.id, manageToken: existing.invitee.manageToken } };
  // A priced repeat that is no longer waiting on payment: a confirmed one is simply returned (even if the host has since
  // downgraded or disconnected), and a released or failed attempt is over, so the guest's page starts a fresh one.
  if (existing && priceMinor && existing.status === "confirmed") return { status: 200, body: { bookingId: existing.id, manageToken: existing.invitee.manageToken } };
  if (existing && priceMinor && existing.status === "cancelled") return { status: 409, body: { error: "attempt_expired" } };

  const questions = await store.listCustomQuestions(host.id, eventType.id);
  const missing = questions.filter((q) => q.required && !req.answers[q.id]);
  if (missing.length > 0) {
    return { status: 400, body: { error: "invalid_request", fields: Object.fromEntries(missing.map((q) => [`answers.${q.id}`, "This one is required."])) } };
  }

  const bookingInput = {
    eventTypeId: eventType.id, startAt: req.start, idempotencyKey: req.idempotencyKey,
    // Used up in the same write as the booking (or its payment hold), so two guests on one link can't both book.
    ...(found.linkToken ? { bookingLinkToken: found.linkToken } : {}),
    invitee: {
      name: req.name, email: req.email, timezone: req.timezone, phone: req.phone,
      answers: questions.filter((q) => req.answers[q.id]).map((q) => ({ questionId: q.id, label: q.label, answer: req.answers[q.id] })),
    },
  };

  // Paid bookings need a paid plan and the host's own Razorpay; checked before the limiter so a refusal costs nothing.
  let paid: { auth: HostRazorpayAuth; deps: PaymentDeps } | null = null;
  if (priceMinor) {
    const auth = payments && (await payments.planFor(host.id)) !== "free" ? await payments.authFor(host.id) : null;
    if (!payments || !auth) return { status: 409, body: { error: "payments_unavailable" } };
    paid = { auth, deps: payments };
  }

  const startPaid = async (p: { auth: HostRazorpayAuth; deps: PaymentDeps }, priceMinor: number, status: number): Promise<HandlerResult> => {
    const { booking, payment } = await startPaidBooking(
      { pool: p.deps.pool, store, auth: p.auth, orders: p.deps.ordersFor(p.auth) }, { ...bookingInput, priceMinor }, now);
    return { status, body: { bookingId: booking.id, manageToken: booking.invitee.manageToken, payment: payment && { ...payment, holdExpiresAt: payment.holdExpiresAt.toISOString() } } };
  };

  try {
    // The repeat skips the slot re-check and the limiter, as the free repeat above does.
    if (existing && paid && priceMinor) return await startPaid(paid, priceMinor, 200);

    // Server-side re-check: the start must be one the engine offers right now.
    const offered = await freeSlots(store, host, eventType, req.start, new Date(req.start.getTime() + MIN), now);
    if (!offered.some((s) => s.getTime() === req.start.getTime())) return slotTaken(store, host, eventType, req.start, now);

    // Charged only once the request has passed every check, so a guest fixing a mistake or picking another slot isn't refused.
    if (limit && (!limit.limiter.take(`booking-ip:${limit.clientKey}`, BOOKING_LIMITS.perIp) || !limit.limiter.take(`booking-email:${req.email.toLowerCase()}`, BOOKING_LIMITS.perEmail))) {
      return { status: 429, body: { error: "too_many_requests" } };
    }

    if (paid && priceMinor) return await startPaid(paid, priceMinor, 201);
    const booking = await store.createBooking(bookingInput);
    return { status: 201, body: { bookingId: booking.id, manageToken: booking.invitee.manageToken } };
  } catch (err) {
    if (isNamedError(err, "SlotTakenError")) return slotTaken(store, host, eventType, req.start, now);
    if (isNamedError(err, "RequestKeyConflictError")) return { status: 409, body: { error: "key_conflict" } };
    if (isNamedError(err, "LinkUsedError")) return linkRefusal("used");
    if (isNamedError<LinkUnavailableError>(err, "LinkUnavailableError")) return linkRefusal(err.status);
    if (isNamedError(err, "PaymentStartError")) return { status: 502, body: { error: "payment_unavailable" } };
    throw err;
  }
}

/** Upcoming bookings soonest first, then past ones most recent first. */
export function upcomingFirst<B extends Pick<Booking, "endAt">>(bookings: B[], at: Date = new Date()): { bookings: B[]; now: number } {
  const now = at.getTime();
  const byStart = [...bookings].sort((a, b) => a.endAt.getTime() - b.endAt.getTime());
  return { bookings: [...byStart.filter((b) => b.endAt.getTime() >= now), ...byStart.filter((b) => b.endAt.getTime() < now).reverse()], now };
}
