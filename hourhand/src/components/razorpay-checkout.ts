// Razorpay's hosted Checkout, loaded only on the page that needs it. The guest pays the host's own Razorpay account;
// the browser result is only a hint, and the server checks it with Razorpay before confirming anything.

export interface CheckoutPayment { keyId: string; orderId: string; amount: number; currency: string; holdExpiresAt: string }
export interface CheckoutResult { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }

interface RazorpayInstance { open(): void }
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

const SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<RazorpayCtor> | null = null;

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay didn't load")));
    s.onerror = () => {
      loading = null; // let a retry try again
      reject(new Error("Razorpay didn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Checkout for an order. Resolves with the result when the guest pays, or null if they close it. */
export async function payWithRazorpay(payment: CheckoutPayment, info: { name: string; description: string; prefill: { name: string; email: string; contact?: string } }): Promise<CheckoutResult | null> {
  const Razorpay = await loadCheckout();
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      key: payment.keyId, order_id: payment.orderId, amount: payment.amount, currency: payment.currency,
      name: info.name, description: info.description, prefill: info.prefill,
      // Checkout closes itself when the hold runs out, so nobody pays for a time that's no longer held.
      timeout: Math.max(1, Math.floor((new Date(payment.holdExpiresAt).getTime() - Date.now()) / 1000)),
      handler: (r: CheckoutResult) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.open();
  });
}
