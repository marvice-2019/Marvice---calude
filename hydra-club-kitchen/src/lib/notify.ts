import { createHmac, randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { auditLog } from "@/db/schema";

export type BookingEventType =
  | "booking.created"
  | "booking.confirmed"
  | "booking.cancelled"
  | "booking.no_show"
  | "booking.completed";

export type BookingEventPayload = {
  ref: string;
  status: string;
  table: string;
  zone: string;
  service_date: string;
  time: string; // HH:mm IST
  starts_at: string;
  ends_at: string;
  guests: number;
  name: string;
  /** Null for a walk-in who gave no phone. */
  phone_e164: string | null;
  notes: string | null;
  cancelled_by?: "guest" | "staff";
};

export type WebhookConfig = {
  url?: string;
  secret?: string;
  /** Waits before each retry. Default 2s, 10s, 30s (4 attempts in ~42s). */
  retryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Stripe-style signature over "<unix seconds>.<raw body>":
 *   X-Hydra-Signature: t=1733300000,v1=<hex HMAC-SHA256>
 * n8n recomputes it from the raw body and rejects stale timestamps (replay).
 */
export function signPayload(secret: string, body: string, unixSec: number): string {
  const mac = createHmac("sha256", secret).update(`${unixSec}.${body}`).digest("hex");
  return `t=${unixSec},v1=${mac}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deliver one booking event to n8n. Never throws: the guest's request has
 * already been answered. Retries network errors, 429 and 5xx; a final failure
 * is written to audit_log (without guest details) so staff can see it.
 */
export async function deliverBookingEvent(
  db: Db,
  type: BookingEventType,
  booking: BookingEventPayload,
  cfg: WebhookConfig = {
    url: process.env.N8N_BOOKING_WEBHOOK_URL,
    secret: process.env.N8N_WEBHOOK_SECRET,
  },
): Promise<"delivered" | "failed" | "not_configured"> {
  if (!cfg.url || !cfg.secret) return "not_configured";
  const doFetch = cfg.fetchImpl ?? fetch;
  const delays = cfg.retryDelaysMs ?? [2_000, 10_000, 30_000];
  const body = JSON.stringify({ id: randomUUID(), type, occurred_at: new Date().toISOString(), booking });

  let lastError = "";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]!);
    try {
      const res = await doFetch(cfg.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hydra-signature": signPayload(cfg.secret, body, Math.floor(Date.now() / 1000)),
          "x-hydra-event": type,
        },
        body,
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
      });
      if (res.ok) return "delivered";
      lastError = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // our request is wrong; retrying won't help
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
    }
  }

  try {
    await db.insert(auditLog).values({
      userId: null,
      action: "webhook.failed",
      entity: "booking",
      entityId: booking.ref,
      diff: { event: type, error: lastError },
    });
  } catch (err) {
    console.error("webhook.failed and could not write audit_log", err);
  }
  return "failed";
}
