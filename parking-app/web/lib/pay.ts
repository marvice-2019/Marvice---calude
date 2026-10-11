import type { RazorpayOrder } from "./types";

export type PayOutcome = "paid" | "failed" | "cancelled";
type RzpInstance = { open(): void; on(ev: string, cb: () => void): void };
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => RzpInstance } }

// The checkout script loads only here, only when someone pays (SPEC §4: no third-party JS on other pages).
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.async = true;
    s.onload = () => ok(); s.onerror = () => fail(new Error("Couldn't load the payment window. Check your connection."));
    document.head.appendChild(s);
  });
}

/**
 * Collect payment for an order. The pass is issued by the API's webhook, not by this return value:
 * "paid" only means the gateway said so; the caller polls until the booking turns confirmed.
 */
export async function pay(order: RazorpayOrder, prefill: { contact?: string; method?: string }, description: string): Promise<PayOutcome> {
  if (order.key_id === "rzp_test_fake") {
    const r = await fetch("/api/dev/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: order.id, amount: order.amount }) });
    return r.ok ? "paid" : "failed";
  }
  await loadCheckout();
  return new Promise(resolve => {
    const rzp = new window.Razorpay!({
      key: order.key_id, order_id: order.id, amount: order.amount, currency: order.currency, name: "Bayline", description,
      prefill: { contact: prefill.contact, method: prefill.method }, theme: { color: "#1446A0" },
      handler: () => resolve("paid"), modal: { ondismiss: () => resolve("cancelled") }
    });
    rzp.on("payment.failed", () => resolve("failed"));
    rzp.open();
  });
}
