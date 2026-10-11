import type { HandlerResult, PaymentDeps } from "../booking";
import { isNamedError } from "../data/types";
import { BOOKING_LIMITS, CONFIRM_PAYMENT_LIMIT, type createRateLimiter } from "../rate-limit";
import { confirmPurchase, publicPackage, startPurchase, type PurchaseStartError, type PurchaseVerifyError } from "./packages";

type Limiter = Pick<ReturnType<typeof createRateLimiter>, "take">;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/packages/[id]/buy with { name, email, phone?, idempotencyKey }: a pending purchase and its Razorpay order. */
export async function handleStartPurchase(
  deps: PaymentDeps | null, packageId: string, input: unknown, limit?: { clientKey: string; limiter: Limiter },
): Promise<HandlerResult> {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const name = str("name"), email = str("email"), phone = str("phone"), idempotencyKey = str("idempotencyKey");
  const fields: Record<string, string> = {};
  if (name.length < 1 || name.length > 100) fields.name = "Enter your name (up to 100 characters).";
  if (!EMAIL.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) fields.phone = "Enter a phone number with country code, like +91 98765 43210.";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) fields.idempotencyKey = "Missing request key.";
  if (Object.keys(fields).length > 0) return { status: 400, body: { error: "invalid_request", fields } };

  if (!deps) return { status: 409, body: { error: "payments_unavailable" } };
  const found = await publicPackage(deps.pool, packageId);
  if (!found) return { status: 404, body: { error: "not_found" } };
  // Selling needs a paid plan and the host's own Razorpay, like a priced event type.
  const auth = (await deps.planFor(found.host.id)) !== "free" ? await deps.authFor(found.host.id) : null;
  if (!auth) return { status: 409, body: { error: "payments_unavailable" } };
  if (limit && (!limit.limiter.take(`purchase-ip:${limit.clientKey}`, BOOKING_LIMITS.perIp) || !limit.limiter.take(`purchase-email:${email.toLowerCase()}`, BOOKING_LIMITS.perEmail))) {
    return { status: 429, body: { error: "too_many_requests" } };
  }
  try {
    const r = await startPurchase({ pool: deps.pool, auth, orders: deps.ordersFor(auth) }, { packageId, name, email, phone: phone || null, idempotencyKey });
    return { status: 200, body: r };
  } catch (err) {
    if (isNamedError(err, "NotFoundError")) return { status: 404, body: { error: "not_found" } };
    if (isNamedError<PurchaseStartError>(err, "PurchaseStartError")) return { status: 502, body: { error: "payment_unavailable" } };
    throw err;
  }
}

/** POST /api/packages/pay with { token, paymentId, signature } from Checkout: checked with Razorpay, then the purchase is paid. */
export async function handleConfirmPurchase(
  deps: PaymentDeps | null, input: unknown, now: Date, limit?: { clientKey: string; limiter: Limiter },
): Promise<HandlerResult> {
  const body = (input ?? {}) as Record<string, unknown>;
  const ok = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;
  const bad = ["token", "paymentId", "signature"].filter((k) => !ok(body[k]));
  if (bad.length > 0) return { status: 400, body: { error: "invalid_request", fields: Object.fromEntries(bad.map((k) => [k, "Required."])) } };
  if (limit && !limit.limiter.take(`confirm-purchase:${limit.clientKey}`, CONFIRM_PAYMENT_LIMIT)) return { status: 429, body: { error: "too_many_requests" } };
  if (!deps) return { status: 409, body: { error: "payments_unavailable" } };
  const { rows: [p] } = await deps.pool.query("select host_id from package_purchases where token = $1", [body.token]);
  if (!p) return { status: 404, body: { error: "not_found" } };
  const auth = await deps.authFor(p.host_id);
  if (!auth) return { status: 409, body: { error: "payments_unavailable" } };
  try {
    const status = await confirmPurchase({ pool: deps.pool, auth, orders: deps.ordersFor(auth) }, { token: body.token as string, paymentId: body.paymentId as string, signature: body.signature as string }, now);
    return { status: 200, body: { status } };
  } catch (err) {
    if (isNamedError<PurchaseVerifyError>(err, "PurchaseVerifyError")) return { status: 400, body: { error: err.reason } };
    throw err;
  }
}
