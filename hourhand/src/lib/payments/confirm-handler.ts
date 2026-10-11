import type { HandlerResult } from "../booking";
import type { DataStore } from "../data/types";
import { CONFIRM_PAYMENT_LIMIT, type createRateLimiter } from "../rate-limit";
import { confirmPayment, PaymentVerifyError } from "./booking-payments";
import type { PaymentCheckDeps } from "./booking-payments";
import type pg from "pg";

type Limiter = Pick<ReturnType<typeof createRateLimiter>, "take">;

const field = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;

/** POST /api/bookings/pay: what Razorpay Checkout handed the guest's browser, checked and applied to their booking. */
export async function handleConfirmPayment(
  store: Pick<DataStore, "getBookingByManageToken">, deps: (PaymentCheckDeps & { pool: pg.Pool }) | null, input: unknown, now: Date,
  limit?: { clientKey: string; limiter: Limiter },
): Promise<HandlerResult> {
  const body = (input ?? {}) as Record<string, unknown>;
  const bad = ["manageToken", "paymentId", "signature"].filter((k) => !field(body[k]));
  if (bad.length > 0) return { status: 400, body: { error: "invalid_request", fields: Object.fromEntries(bad.map((k) => [k, "Required."])) } };
  // Each try costs a Razorpay API call on the host's account, so one address can't hammer it.
  if (limit && !limit.limiter.take(`confirm-payment:${limit.clientKey}`, CONFIRM_PAYMENT_LIMIT)) return { status: 429, body: { error: "too_many_requests" } };

  const booking = await store.getBookingByManageToken(body.manageToken as string);
  if (!booking) return { status: 404, body: { error: "not_found" } };
  const auth = deps ? await deps.authFor(booking.hostId) : null;
  if (!deps || !auth) return { status: 409, body: { error: "payments_unavailable" } };
  try {
    const status = await confirmPayment(
      { pool: deps.pool, auth, orders: deps.ordersFor(auth) }, { bookingId: booking.id, paymentId: body.paymentId as string, signature: body.signature as string }, now);
    return { status: 200, body: { status } };
  } catch (err) {
    if (err instanceof PaymentVerifyError) return { status: 400, body: { error: err.reason } };
    throw err;
  }
}
