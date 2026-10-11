import RazorpayCheckout from "react-native-razorpay";
import type { RazorpayOrder } from "@/shared/types";

export type PayOutcome = "paid" | "failed" | "cancelled";

// Dev builds only: the API's fake gateway ("rzp_test_fake") is settled by the web app's /api/dev/pay,
// which signs the webhook. The webhook secret never ships in the app.
async function devPay(order: RazorpayOrder): Promise<PayOutcome> {
  const url = process.env.EXPO_PUBLIC_DEV_PAY_URL;
  if (!url) return "failed";
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: order.id, amount: order.amount }) });
  return r.ok ? "paid" : "failed";
}

/**
 * Collect payment through Razorpay's native SDK (UPI intent on Android opens GPay/PhonePe/Paytm directly).
 * "paid" means the gateway said so; the pass is issued by the API webhook, so callers poll the booking.
 */
export async function pay(order: RazorpayOrder, prefill: { contact?: string; method?: string }, description: string): Promise<PayOutcome> {
  if (order.key_id === "rzp_test_fake") return devPay(order);
  try {
    await RazorpayCheckout.open({
      key: order.key_id, order_id: order.id, amount: order.amount, currency: order.currency, name: "Bayline", description,
      prefill: { contact: prefill.contact?.replace(/^\+91/, ""), method: prefill.method }, theme: { color: "#1446A0" }
    });
    return "paid";
  } catch (e) {
    // Android SDK: Checkout.PAYMENT_CANCELED = 0 (user closed the sheet). Everything else, including
    // NETWORK_ERROR = 2, is a failure. Confirm the iOS code on a device (see README "needs a device").
    const code = (e as { code?: number }).code;
    return code === 0 ? "cancelled" : "failed";
  }
}
