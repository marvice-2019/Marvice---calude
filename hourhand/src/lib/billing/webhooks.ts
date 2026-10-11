import { createHmac, timingSafeEqual } from "node:crypto";
import type { Provider } from "./plans";

// Webhook signatures and the little Hourhand needs from each event: its id (for deduplication) and the subscription it
// is about. The event body is never trusted for plan state; the subscription is re-read from the provider.

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data, "utf8").digest("hex");

/** Razorpay: X-Razorpay-Signature is the hex HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyRazorpaySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !/^[0-9a-f]+$/i.test(header)) return false;
  return sameHex(hmacHex(secret, rawBody), header.toLowerCase());
}

/**
 * Stripe: Stripe-Signature is "t=<unix>,v1=<hex>[,v1=<hex>]". The signed text is "<t>.<raw body>". Events older than
 * the tolerance are refused so a captured request can't be replayed later.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = new Date(), toleranceSec = 300): boolean {
  if (!header) return false;
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t") t = v ?? null;
    else if (k === "v1" && v && /^[0-9a-f]+$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (!t || !/^\d+$/.test(t) || v1.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = hmacHex(secret, `${t}.${rawBody}`);
  return v1.some((sig) => sameHex(expected, sig));
}

export interface WebhookEvent {
  provider: Provider;
  eventId: string;
  type: string;
  /** The subscription this event is about, or null when Hourhand has nothing to do with it. */
  subscriptionId: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Razorpay's event id comes in the x-razorpay-event-id header. */
export function parseRazorpayEvent(body: Json, eventIdHeader: string | null): WebhookEvent | null {
  const type = str(body.event);
  if (!type) return null;
  const sub = obj(obj(obj(body.payload).subscription).entity);
  const subscriptionId = type.startsWith("subscription.") ? str(sub.id) : null;
  // Without the header, the event type, subscription and its timestamp identify a delivery well enough to deduplicate.
  const eventId = eventIdHeader ?? `${type}:${subscriptionId ?? "none"}:${String(body.created_at ?? "")}`;
  return { provider: "razorpay", eventId, type, subscriptionId };
}

export function parseStripeEvent(body: Json): WebhookEvent | null {
  const eventId = str(body.id);
  const type = str(body.type);
  if (!eventId || !type) return null;
  const o = obj(obj(body.data).object);
  let subscriptionId: string | null = null;
  if (type.startsWith("customer.subscription.")) subscriptionId = str(o.id);
  else if (type === "checkout.session.completed" && o.mode === "subscription") subscriptionId = str(o.subscription);
  else if (type.startsWith("invoice.")) {
    // Older API versions put it on the invoice; newer ones under parent.subscription_details.
    subscriptionId = str(o.subscription) ?? str(obj(obj(o.parent).subscription_details).subscription);
  }
  return { provider: "stripe", eventId, type, subscriptionId };
}
