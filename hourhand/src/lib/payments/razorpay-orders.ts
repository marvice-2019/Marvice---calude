import { send, type Fetch } from "../billing/providers";
import { razorpayApiBase, type HostRazorpayAuth } from "./host-razorpay";

// Orders and payments on the host's own Razorpay account, authenticated as the host.

export type RazorpayPaymentStatus = "created" | "authorized" | "captured" | "refunded" | "failed";

export interface RazorpayOrder { id: string; amount: number; currency: string; status: string }
export interface RazorpayPayment { id: string; orderId: string | null; amount: number; currency: string; status: RazorpayPaymentStatus }
export interface RazorpayRefund { id: string; status: "pending" | "processed" | "failed"; amount: number }

export interface RazorpayOrders {
  createOrder(o: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder>;
  /** Every authorized, captured or failed payment made against the order. */
  orderPayments(orderId: string): Promise<RazorpayPayment[]>;
  getPayment(paymentId: string): Promise<RazorpayPayment>;
  capture(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment>;
  /** Full refund unless `amount` is given. `receipt` makes a repeat of the same refund request fail instead of paying twice. */
  refund(paymentId: string, o: { amount?: number; receipt: string; notes?: Record<string, string> }): Promise<RazorpayRefund>;
  /** Refunds already made on the payment, to tell whether an earlier attempt went through. */
  listRefunds(paymentId: string): Promise<RazorpayRefund[]>;
}

const toPayment = (p: Record<string, unknown>): RazorpayPayment => ({
  id: p.id as string, orderId: (p.order_id as string) ?? null, amount: p.amount as number, currency: p.currency as string,
  status: p.status as RazorpayPaymentStatus,
});
const toRefund = (r: Record<string, unknown>): RazorpayRefund => ({ id: r.id as string, status: r.status as RazorpayRefund["status"], amount: r.amount as number });

export function razorpayOrders(auth: HostRazorpayAuth, opts: { baseUrl?: string; fetchImpl?: Fetch } = {}): RazorpayOrders {
  const base = (opts.baseUrl ?? razorpayApiBase()).replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  const call = (method: string, path: string, body?: unknown) =>
    send(f, `${base}/v1${path}`, {
      method, headers: { ...auth.headers(), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }, "Razorpay");
  const id = encodeURIComponent;
  return {
    async createOrder(o) {
      const r = await call("POST", "/orders", { amount: o.amount, currency: o.currency, receipt: o.receipt, notes: o.notes });
      return { id: r.id as string, amount: r.amount as number, currency: r.currency as string, status: r.status as string };
    },
    async orderPayments(orderId) {
      const r = await call("GET", `/orders/${id(orderId)}/payments`);
      return ((r.items as Record<string, unknown>[] | undefined) ?? []).map(toPayment);
    },
    async getPayment(paymentId) { return toPayment(await call("GET", `/payments/${id(paymentId)}`)); },
    async capture(paymentId, amount, currency) { return toPayment(await call("POST", `/payments/${id(paymentId)}/capture`, { amount, currency })); },
    async refund(paymentId, o) { return toRefund(await call("POST", `/payments/${id(paymentId)}/refund`, { ...o, speed: "normal" })); },
    async listRefunds(paymentId) {
      const r = await call("GET", `/payments/${id(paymentId)}/refunds`);
      return ((r.items as Record<string, unknown>[] | undefined) ?? []).map(toRefund);
    },
  };
}
