import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";

/* ---------- payments ---------- */
export type Order = { id: string; amountPaise: number; currency: "INR" };
export interface Payments {
  createOrder(amountPaise: number, receipt: string): Promise<Order>;
  refund(razorpayPaymentId: string, amountPaise: number): Promise<{ id: string }>;
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  keyId: string;
}

function hmacOk(secret: string, body: string, sig: string | undefined): boolean {
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Razorpay REST: POST /v1/orders, POST /v1/payments/:id/refund; webhook header X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret).
export function razorpay(cfg: Config): Payments {
  const auth = "Basic " + Buffer.from(`${cfg.RAZORPAY_KEY_ID}:${cfg.RAZORPAY_KEY_SECRET}`).toString("base64");
  async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Razorpay ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }
  return {
    keyId: cfg.RAZORPAY_KEY_ID!,
    async createOrder(amountPaise, receipt) {
      const o = await call<{ id: string }>("/orders", { amount: amountPaise, currency: "INR", receipt });
      return { id: o.id, amountPaise, currency: "INR" };
    },
    async refund(paymentId, amountPaise) {
      return call<{ id: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise });
    },
    verifyWebhook: (raw, sig) => hmacOk(cfg.RAZORPAY_WEBHOOK_SECRET, raw, sig)
  };
}

// Dev and test stand-in: same interface, no network. Never used in production (config refuses).
export function fakePayments(cfg: Config): Payments & { orders: Order[]; refunds: { paymentId: string; amountPaise: number }[] } {
  const orders: Order[] = [], refunds: { paymentId: string; amountPaise: number }[] = [];
  return {
    keyId: "rzp_test_fake", orders, refunds,
    async createOrder(amountPaise) { const o = { id: "order_" + randomBytes(7).toString("hex"), amountPaise, currency: "INR" as const }; orders.push(o); return o; },
    async refund(paymentId, amountPaise) { refunds.push({ paymentId, amountPaise }); return { id: "rfnd_" + randomBytes(7).toString("hex") }; },
    verifyWebhook: (raw, sig) => hmacOk(cfg.RAZORPAY_WEBHOOK_SECRET, raw, sig)
  };
}

/* ---------- OTP ---------- */
export interface OtpSender { send(phone: string, code: string): Promise<void> }

export function otpSender(cfg: Config, log: (m: string) => void): OtpSender {
  if (cfg.OTP_PROVIDER === "console") return { async send(phone, code) { log(`[dev OTP] ${phone}: ${code}`); } };
  // SPEC open question #5: provider not chosen yet. Fail loudly rather than pretend to send.
  return { async send() { throw new Error(`OTP provider ${cfg.OTP_PROVIDER} is not implemented yet (SPEC open question #5)`); } };
}

/* ---------- notifications (WhatsApp/SMS/push via n8n) ---------- */
export type Notice = { event: string; phone?: string; data: Record<string, unknown> };
export interface Notifier { send(n: Notice): void; sent: Notice[] }

export function notifier(cfg: Config, log: { warn: (o: object, m: string) => void; info: (o: object, m: string) => void }): Notifier {
  const sent: Notice[] = [];
  return {
    sent,
    send(n) {
      sent.push(n);
      if (!cfg.N8N_NOTIFY_URL) { log.info({ notice: n.event }, "notify (no N8N_NOTIFY_URL set)"); return; }
      // fire-and-forget: a notification failure must never fail a payment
      fetch(cfg.N8N_NOTIFY_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(n) })
        .then(r => { if (!r.ok) log.warn({ status: r.status, event: n.event }, "notify failed"); })
        .catch(e => log.warn({ err: String(e), event: n.event }, "notify failed"));
    }
  };
}
