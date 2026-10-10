import { freeSlots, slotTaken, type HandlerResult } from "./booking";
import { SlotTakenError, type DataStore } from "./data/types";

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

  await store.cancelBooking(booking.id, "guest", text || undefined);
  return { status: 200, body: { status: "cancelled" } };
}

/** POST /api/b/[token]/reschedule with { start, idempotencyKey }. */
export async function handleReschedule(store: DataStore, token: string, input: unknown, now: Date): Promise<HandlerResult> {
  const booking = await store.getBookingByManageToken(token);
  if (!booking) return notFound;

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

  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  if (!host || !eventType) return notFound;

  // The new start must be one the engine offers right now, not counting the booking being moved.
  const offered = await freeSlots(store, host, eventType, start, new Date(start.getTime() + MIN), now, booking.id);
  if (!offered.some((s) => s.getTime() === start.getTime())) return slotTaken(store, host, eventType, start, now, booking.id);

  try {
    const moved = await store.rescheduleBooking(booking.id, start, idempotencyKey);
    return { status: 201, body: { bookingId: moved.id, manageToken: moved.invitee.manageToken } };
  } catch (err) {
    if (err instanceof SlotTakenError) return slotTaken(store, host, eventType, start, now, booking.id);
    throw err;
  }
}
