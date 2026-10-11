import { NextResponse } from "next/server";
import { getPool } from "../data/pg-store";
import { billingFor } from "./env";
import type { Provider } from "./plans";
import { handleWebhook } from "./sync";
import { parseRazorpayEvent, parseStripeEvent, verifyRazorpaySignature, verifyStripeSignature } from "./webhooks";

/**
 * The shared webhook handler: raw body, signature check, then record-and-sync. Answers 200 once the event is handled
 * (or is one Hourhand ignores), 400 for a bad signature or body, and 500 when syncing fails so the provider retries.
 */
export async function receiveWebhook(provider: Provider, request: Request): Promise<Response> {
  const billing = billingFor(provider);
  if (!billing || !process.env.DATABASE_URL) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await request.text();
  const ok = provider === "razorpay"
    ? verifyRazorpaySignature(raw, request.headers.get("x-razorpay-signature"), billing.webhookKey)
    : verifyStripeSignature(raw, request.headers.get("stripe-signature"), billing.webhookKey);
  if (!ok) return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const event = provider === "razorpay" ? parseRazorpayEvent(body, request.headers.get("x-razorpay-event-id")) : parseStripeEvent(body);
  if (!event) return NextResponse.json({ error: "bad_body" }, { status: 400 });
  try {
    const outcome = await handleWebhook(getPool(process.env.DATABASE_URL), billing.api, event, body);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    console.error(`[billing] ${provider} webhook ${event.eventId} (${event.type}) failed; the provider will retry`, error);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
