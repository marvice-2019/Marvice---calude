import type pg from "pg";
import { isIanaTimeZone } from "./booking";
import type { DataStore } from "./data/types";
import { BOOKING_LIMITS, type createRateLimiter } from "./rate-limit";
import { joinWaitlist, validateWaitlist } from "./waitlist";

type Limiter = ReturnType<typeof createRateLimiter>;
type HandlerResult = { status: number; body: Record<string, unknown> };

/** POST /api/waitlist: a guest leaves their email for a full day of a public event type. Needs Postgres (the job queue). */
export async function handleJoinWaitlist(
  pool: pg.Pool | null, store: DataStore, input: unknown, now: Date, limit?: { clientKey: string; limiter: Limiter },
): Promise<HandlerResult> {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  if (!pool) return { status: 409, body: { error: "waitlist_unavailable" } };
  const found = await store.getPublicEventType(str("slug"), str("event"));
  if (!found) return { status: 404, body: { error: "not_found" } };
  const v = validateWaitlist(body, now, found.eventType.bookingWindowDays, isIanaTimeZone);
  if (!v.ok) return { status: 400, body: { error: "invalid_request", fields: v.fields } };
  if (limit && (!limit.limiter.take(`waitlist-ip:${limit.clientKey}`, BOOKING_LIMITS.perIp) || !limit.limiter.take(`waitlist-email:${v.value.email.toLowerCase()}`, BOOKING_LIMITS.perEmail))) {
    return { status: 429, body: { error: "too_many_requests" } };
  }
  await joinWaitlist(pool, found.host.id, found.eventType.id, v.value);
  return { status: 200, body: { ok: true } };
}
