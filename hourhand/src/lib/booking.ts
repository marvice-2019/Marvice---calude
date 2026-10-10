import { computeSlots, isSyncStale } from "./slots";
import { SlotTakenError, type DataStore, type EventType, type User } from "./data/types";

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

/** Free slot starts for one public event type, using everything the engine needs from the store. */
export async function freeSlots(store: DataStore, host: User, eventType: EventType, from: Date, to: Date, now: Date): Promise<Date[]> {
  const [{ schedule, rules }, connections, busyBlocks, bookings] = await Promise.all([
    store.getDefaultSchedule(host.id),
    store.listCalendarConnections(host.id),
    store.listBusyBlocks(host.id, new Date(from.getTime() - DAY), new Date(to.getTime() + DAY)),
    store.listBookings(host.id),
  ]);
  return computeSlots({
    eventType, schedule, rules, busyBlocks, bookings, now, rangeStart: from, rangeEnd: to,
    syncStale: isSyncStale(connections, now),
  });
}

/** GET /api/slots?slug=&event=&from=&to=&tz= */
export async function handleGetSlots(store: DataStore, params: URLSearchParams, now: Date): Promise<HandlerResult> {
  const errors: Record<string, string> = {};
  const slug = params.get("slug") ?? "";
  const event = params.get("event") ?? "";
  const from = parseInstant(params.get("from"));
  const to = parseInstant(params.get("to"));
  const tz = params.get("tz");
  if (!slug) errors.slug = "Required.";
  if (!event) errors.event = "Required.";
  if (!from) errors.from = "Must be an ISO date-time.";
  if (!to) errors.to = "Must be an ISO date-time.";
  if (from && to && (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY)) {
    errors.to = `Must be after from, at most ${MAX_RANGE_DAYS} days later.`;
  }
  if (tz !== null && !isIanaTimeZone(tz)) errors.tz = "Must be an IANA time zone.";
  if (Object.keys(errors).length > 0 || !from || !to) return { status: 400, body: { error: "invalid_request", fields: errors } };

  const found = await store.getPublicEventType(slug, event);
  if (!found) return { status: 404, body: { error: "not_found" } };
  const slots = await freeSlots(store, found.host, found.eventType, from, to, now);
  return { status: 200, body: { timezone: tz ?? found.host.timezone, slots: slots.map((s) => s.toISOString()) } };
}

export interface BookingRequest {
  slug: string;
  event: string;
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
  if (!str("slug")) fields.slug = "Required.";
  if (!str("event")) fields.event = "Required.";
  if (!start) fields.start = "Pick a time.";
  if (name.length < 1 || name.length > 100) fields.name = "Enter your name (up to 100 characters).";
  if (!EMAIL.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  if (!isIanaTimeZone(body.timezone)) fields.timezone = "Pick a valid time zone.";
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) fields.phone = "Enter a phone number with country code, like +91 98765 43210.";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) fields.idempotencyKey = "Missing request key.";

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
    value: { slug: str("slug"), event: str("event"), start, name, email, timezone: body.timezone as string, phone: phone || null, answers, idempotencyKey },
  };
}

async function slotTaken(store: DataStore, host: User, eventType: EventType, after: Date, now: Date): Promise<HandlerResult> {
  const windowEnd = new Date(now.getTime() + eventType.bookingWindowDays * DAY);
  const slots = await freeSlots(store, host, eventType, now, windowEnd, now);
  const later = slots.filter((s) => s >= after);
  const nextSlots = (later.length > 0 ? later : slots).slice(0, 3).map((s) => s.toISOString());
  return { status: 409, body: { error: "slot_taken", nextSlots } };
}

/** POST /api/bookings */
export async function handleCreateBooking(store: DataStore, input: unknown, now: Date): Promise<HandlerResult> {
  const v = validateBookingRequest(input);
  if (!v.ok) return { status: 400, body: { error: "invalid_request", fields: v.fields } };
  const req = v.value;

  const found = await store.getPublicEventType(req.slug, req.event);
  if (!found) return { status: 404, body: { error: "not_found" } };
  const { host, eventType } = found;

  // A repeated submit returns the booking it already made, before the slot re-check (which it would now fail).
  const existing = (await store.listBookings(host.id)).find((b) => b.idempotencyKey === req.idempotencyKey);
  if (existing) return { status: 200, body: { bookingId: existing.id, manageToken: existing.invitee.manageToken } };

  const missing = (await store.listCustomQuestions(eventType.id)).filter((q) => q.required && !req.answers[q.id]);
  if (missing.length > 0) {
    return { status: 400, body: { error: "invalid_request", fields: Object.fromEntries(missing.map((q) => [`answers.${q.id}`, "This one is required."])) } };
  }

  // Server-side re-check: the start must be one the engine offers right now.
  const offered = await freeSlots(store, host, eventType, req.start, new Date(req.start.getTime() + MIN), now);
  if (!offered.some((s) => s.getTime() === req.start.getTime())) return slotTaken(store, host, eventType, req.start, now);

  try {
    const booking = await store.createBooking({
      eventTypeId: eventType.id, startAt: req.start, idempotencyKey: req.idempotencyKey,
      invitee: { name: req.name, email: req.email, timezone: req.timezone },
    });
    return { status: 201, body: { bookingId: booking.id, manageToken: booking.invitee.manageToken } };
  } catch (err) {
    if (err instanceof SlotTakenError) return slotTaken(store, host, eventType, req.start, now);
    throw err;
  }
}
