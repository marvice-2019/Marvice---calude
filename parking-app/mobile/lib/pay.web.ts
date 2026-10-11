import type { RazorpayOrder } from "@/shared/types";

export type PayOutcome = "paid" | "failed" | "cancelled";
type Rzp = { open(): void; on(ev: string, cb: () => void): void };
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => Rzp } }

// Web preview: Razorpay's hosted checkout script, loaded only when someone pays.
export async function pay(order: RazorpayOrder, prefill: { contact?: string }, description: string): Promise<PayOutcome> {
  if (order.key_id === "rzp_test_fake") {
    const url = process.env.EXPO_PUBLIC_DEV_PAY_URL;
    if (!url) return "failed";
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: order.id, amount: order.amount }) });
    return r.ok ? "paid" : "failed";
  }
  if (!window.Razorpay) {
    await new Promise<void>((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = () => ok(); s.onerror = () => fail(new Error("load"));
      document.head.appendChild(s);
    }).catch(() => undefined);
  }
  if (!window.Razorpay) return "failed";
  return new Promise(resolve => {
    const r = new window.Razorpay!({ key: order.key_id, order_id: order.id, amount: order.amount, currency: order.currency, name: "Bayline", description,
      prefill: { contact: prefill.contact }, handler: () => resolve("paid"), modal: { ondismiss: () => resolve("cancelled") } });
    r.on("payment.failed", () => resolve("failed"));
    r.open();
  });
}
