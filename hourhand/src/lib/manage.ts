import { freeSlots, slotTaken, type HandlerResult } from "./booking";
import { RequestKeyConflictError, SlotTakenError, type BookingWithInvitee, type DataStore } from "./data/types";

const MIN = 60_000;
const MAX_REASON = 500;

const notFound: HandlerResult = { status: 404, body: { error: "not_found" } };

/** POST /api/b/[token]/cancel. Cancelling an already-cancelled booking succeeds again. */
export async function handleCancel(store: DataStore, token: string, reason: unknown, now: Date): Promise<HandlerResult> {
  const booking = await store.getBookingByManageToken(token);
  if (!booking) return notFound;
  if (booking.status === "cancelled") return { status: 200, body: { status: "cancelled" } };

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return { status: 400, body: { error: "invalid_request", fields: { reason: "Reason must be text." } } };
  }
  const text = (reason ?? "").trim();
  if (text.length > MAX_REASON) {
    return { status: 400, body: { error: "invalid_request", fields: { reason: `Keep it under ${MAX_REASON} characters.` } } };
  }

  const eventType = await store.getEventType(booking.hostId, booking.eventTypeId);
  const cutoffMs = (eventType?.cancelCutoffMinutes ?? 0) * MIN;
  if (booking.startAt.getTime() - now.getTime() < cutoffMs) return { status: 409, body: { error: "past_cutoff" } };

  await store.cancelBooking(booking.hostId, booking.id, "guest", text || undefined);
  return { status: 200, body: { status: "cancelled" } };
}

/** POST /api/b/[token]/reschedule with { start, idempotencyKey }. */
export async function handleReschedule(store: DataStore, token: string, input: unknown, now: Date): Promise<HandlerResult> {
  const booking = await store.getBookingByManageToken(token);
  if (!booking) return notFound;
  return moveBooking(store, booking, input, now, "guest");
}

/** The host moving one of their own bookings from the dashboard: the same free-slot check as the guest's move. */
export async function handleHostReschedule(store: DataStore, hostId: string, bookingId: string, input: unknown, now: Date): Promise<HandlerResult> {
  const booking = await store.getBooking(hostId, bookingId);
  if (!booking) return notFound;
  // A booking still waiting for payment isn't the host's to move yet.
  if (booking.status === "pending_payment") return { status: 409, body: { error: "not_confirmed" } };
  return moveBooking(store, booking, input, now, "host");
}

async function moveBooking(store: DataStore, booking: BookingWithInvitee, input: unknown, now: Date, by: "host" | "guest"): Promise<HandlerResult> {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const start = typeof body.start === "string" ? new Date(body.start) : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!start || Number.isNaN(start.getTime())) fields.start = "Pick a time.";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) fields.idempotencyKey = "Request key must be 8–100 characters.";
  if (Object.keys(fields).length > 0 || !start) return { status: 400, body: { error: "invalid_request", fields } };

  // A repeated submit returns the booking it already made (the old one is cancelled by then).
  const all = await store.listBookings(booking.hostId);
  const repeat = all.find((b) => b.idempotencyKey === idempotencyKey && b.rescheduledFromId === booking.id);
  if (repeat) return { status: 200, body: { bookingId: repeat.id, manageToken: repeat.invitee.manageToken } };
  if (booking.status === "cancelled") return { status: 409, body: { error: "cancelled" } };
  // The host moves upcoming bookings only (the page hides the form, but a post can still arrive): moving one that
  // already happened would cancel it as the host's and email the guest. Checked after the repeat lookup, so a double
  // submit still gets its booking back.
  if (by === "host" && booking.startAt.getTime() <= now.getTime()) return { status: 409, body: { error: "not_upcoming" } };

  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  if (!host || !eventType) return notFound;

  // The new start must be one the engine offers right now, not counting the booking being moved.
  const offered = await freeSlots(store, host, eventType, start, new Date(start.getTime() + MIN), now, booking.id);
  if (!offered.some((s) => s.getTime() === start.getTime())) return slotTaken(store, host, eventType, start, now, booking.id);

  try {
    const moved = await store.rescheduleBooking(booking.hostId, booking.id, start, idempotencyKey, by);
    return { status: 201, body: { bookingId: moved.id, manageToken: moved.invitee.manageToken } };
  } catch (err) {
    if (err instanceof SlotTakenError) return slotTaken(store, host, eventType, start, now, booking.id);
    if (err instanceof RequestKeyConflictError) return { status: 409, body: { error: "key_conflict" } };
    throw err;
  }
}
