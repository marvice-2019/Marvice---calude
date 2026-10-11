import type pg from "pg";
import { BillingApiError } from "../billing/providers";
import { queueBookingNotifications } from "../data/notifications";
import type { BookingWithInvitee, CreateBookingInput, DataStore } from "../data/types";
import { kickJobs } from "../jobs/kick";
import type { HostRazorpayAuth } from "./host-razorpay";
import type { RazorpayOrders } from "./razorpay-orders";

// Priced bookings: the guest pays the host's own Razorpay account. The booking holds its slot as pending_payment while
// the guest pays, and only becomes confirmed (with its emails) once the captured payment is checked against our records.

export const HOLD_MINUTES = 15;
const CURRENCY = "INR";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the browser needs to open Razorpay Checkout for the held booking. */
export interface CheckoutPayment { orderId: string; keyId: string; amount: number; currency: string; holdExpiresAt: Date }

export class PaymentStartError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PaymentStartError";
    this.retryable = retryable;
  }
}

export type PaymentVerifyReason = "no_payment" | "bad_signature" | "mismatch" | "not_paid";

export class PaymentVerifyError extends Error {
  readonly reason: PaymentVerifyReason;
  constructor(reason: PaymentVerifyReason) {
    super(`Payment could not be verified: ${reason}`);
    this.name = "PaymentVerifyError";
    this.reason = reason;
  }
}

interface PaymentRow { provider_order_id: string; amount_minor: number; currency: string }

const paymentFor = async (db: Pick<pg.Pool, "query">, bookingId: string): Promise<PaymentRow | null> =>
  (await db.query("select provider_order_id, amount_minor, currency from payments where booking_id = $1 and provider = 'razorpay'", [bookingId])).rows[0] ?? null;

async function inTx<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function startPaidBooking(
  deps: { pool: pg.Pool; store: Pick<DataStore, "createBooking">; auth: HostRazorpayAuth; orders: RazorpayOrders },
  input: CreateBookingInput & { priceMinor: number },
  now: Date,
): Promise<{ booking: BookingWithInvitee; payment: CheckoutPayment | null }> {
  const { pool, store, auth, orders } = deps;
  const { priceMinor, ...bookingInput } = input;
  const booking = await store.createBooking({ ...bookingInput, holdUntil: new Date(now.getTime() + HOLD_MINUTES * 60_000) });
  // A repeat of a request whose booking already settled (paid, expired, cancelled): nothing left to pay.
  if (booking.status !== "pending_payment" || !booking.holdExpiresAt) return { booking, payment: null };
  const checkout = (row: PaymentRow): CheckoutPayment =>
    ({ orderId: row.provider_order_id, keyId: auth.keyId, amount: row.amount_minor, currency: row.currency, holdExpiresAt: booking.holdExpiresAt! });

  // A retried request reuses its order, so the guest never ends up with two orders for one booking.
  const existing = await paymentFor(pool, booking.id);
  if (existing) return { booking, payment: checkout(existing) };

  let order;
  try {
    order = await orders.createOrder({ amount: priceMinor, currency: CURRENCY, receipt: booking.id, notes: { booking_id: booking.id } });
  } catch (error) {
    // Without an order the guest can't pay, so free the slot now rather than holding it until the hold lapses.
    await pool.query(
      `update bookings set status = 'cancelled', cancelled_at = $2, cancelled_by = 'system', cancel_reason = 'Payment could not start', hold_expires_at = null
       where id = $1 and status = 'pending_payment'`, [booking.id, now]);
    throw new PaymentStartError(`Payment could not start: ${(error as Error).message}`, error instanceof BillingApiError && error.retryable);
  }
  const row = await inTx(pool, async (client) => {
    // Locked so two concurrent repeats of the request settle on one payment row.
    await client.query("select id from bookings where id = $1 for update", [booking.id]);
    const raced = await paymentFor(client, booking.id);
    if (raced) return raced;
    await client.query(
      `insert into payments (booking_id, host_id, provider, provider_order_id, amount_minor, currency, status) values ($1, $2, 'razorpay', $3, $4, $5, 'pending')`,
      [booking.id, booking.hostId, order.id, priceMinor, CURRENCY]);
    return { provider_order_id: order.id, amount_minor: priceMinor, currency: CURRENCY };
  });
  return { booking, payment: checkout(row) };
}

/**
 * Records a captured payment. A held booking becomes confirmed and its emails go out; a booking cancelled meanwhile
 * (hold lapsed, host cancelled) stays cancelled and its payment is marked for refund, never reviving the slot.
 */
export async function applyCapturedPayment(pool: pg.Pool, bookingId: string, razorpayPaymentId: string, now: Date): Promise<"confirmed" | "already" | "refund_pending"> {
  const result = await inTx(pool, async (client) => {
    const { rows } = await client.query("select status from bookings where id = $1 for update", [bookingId]);
    const status = rows[0]?.status as BookingWithInvitee["status"] | undefined;
    if (!status) throw new Error(`Booking ${bookingId} not found`);
    if (status === "confirmed") return "already" as const;
    if (status === "cancelled") {
      // Only a payment we haven't settled yet; a refund already under way or done is left alone.
      await client.query(
        `update payments set status = 'refund_pending', provider_payment_id = $2, paid_at = coalesce(paid_at, $3), updated_at = $3
         where booking_id = $1 and status in ('pending', 'failed')`, [bookingId, razorpayPaymentId, now]);
      return "refund_pending" as const;
    }
    await client.query("update bookings set status = 'confirmed', hold_expires_at = null where id = $1", [bookingId]);
    await client.query("update payments set status = 'paid', provider_payment_id = $2, paid_at = $3, updated_at = $3 where booking_id = $1", [bookingId, razorpayPaymentId, now]);
    await queueBookingNotifications(client, bookingId, "booked", now);
    return "confirmed" as const;
  });
  if (result === "confirmed") kickJobs();
  return result;
}

/**
 * Confirms a booking from what Razorpay Checkout handed the browser. The order id and amount come from our own payments
 * row, never the client, so a payment made for another order or a smaller amount can't confirm this booking.
 */
export async function confirmPayment(
  deps: { pool: pg.Pool; auth: HostRazorpayAuth; orders: RazorpayOrders },
  input: { bookingId: string; paymentId: string; signature: string },
  now: Date,
): Promise<"confirmed" | "already" | "refund_pending"> {
  const { pool, auth, orders } = deps;
  const row = UUID.test(input.bookingId) ? await paymentFor(pool, input.bookingId) : null;
  if (!row) throw new PaymentVerifyError("no_payment");
  if (!auth.verifyPaymentSignature(row.provider_order_id, input.paymentId, input.signature)) throw new PaymentVerifyError("bad_signature");
  let p = await orders.getPayment(input.paymentId);
  if (p.orderId !== row.provider_order_id) throw new PaymentVerifyError("mismatch");
  if (p.amount !== row.amount_minor || p.currency !== row.currency) throw new PaymentVerifyError("mismatch");
  if (p.status === "authorized") p = await orders.capture(p.id, row.amount_minor, row.currency);
  if (p.status !== "captured") throw new PaymentVerifyError("not_paid");
  return applyCapturedPayment(pool, input.bookingId, p.id, now);
}

/** How the reconciler reaches each host's Razorpay. Injected so tests can use fakes. */
export interface PaymentCheckDeps {
  authFor(hostId: string): Promise<HostRazorpayAuth | null>;
  ordersFor(auth: HostRazorpayAuth): RazorpayOrders;
}

export interface ReconcileResult { claimed: number; confirmed: number; refundPending: number; expired: number; errors: number }

interface DueRow { booking_id: string; host_id: string; provider_order_id: string; booking_status: string; hold_expires_at: Date | null; cancelled_at: Date | null }

// A payment is only checked once it is a minute old and at most once a minute, so a guest still in Checkout isn't polled.
const RECHECK_MS = 60_000;
const LATE_PAYMENT_MS = 30 * 60_000;

async function expireHold(pool: pg.Pool, bookingId: string, now: Date): Promise<boolean> {
  return inTx(pool, async (client) => {
    // Guarded on the status so a payment confirmed meanwhile keeps its booking.
    const { rowCount } = await client.query(
      `update bookings set status = 'cancelled', cancelled_at = $2, cancelled_by = 'system', cancel_reason = 'Payment not completed', hold_expires_at = null
       where id = $1 and status = 'pending_payment'`, [bookingId, now]);
    if (!rowCount) return false;
    await client.query("update payments set status = 'failed', updated_at = $2 where booking_id = $1 and status = 'pending'", [bookingId, now]);
    return true;
  });
}

/**
 * Settles pending payments with Razorpay: guests who paid and closed the tab before we heard back, payments that were
 * only authorized, holds that lapsed unpaid, and payments that landed after the system cancelled the booking.
 */
export async function reconcilePayments(deps: PaymentCheckDeps & { pool: pg.Pool }, now: Date, limit = 20): Promise<ReconcileResult> {
  const { pool } = deps;
  const { rows } = await pool.query<DueRow>(
    `with due as (
       select p.id from payments p join bookings b on b.id = p.booking_id
       where p.provider = 'razorpay' and p.status = 'pending' and p.created_at < $1::timestamptz - $3 * interval '1 millisecond'
         and (p.checked_at is null or p.checked_at < $1::timestamptz - $3 * interval '1 millisecond')
         and (b.status = 'pending_payment' or (b.status = 'cancelled' and b.cancelled_by = 'system'))
       order by p.checked_at nulls first, p.created_at
       limit $2
       for update of p skip locked)
     update payments p set checked_at = $1 from due, bookings b
     where p.id = due.id and b.id = p.booking_id
     returning p.booking_id, p.host_id, p.provider_order_id, b.status as booking_status, b.hold_expires_at, b.cancelled_at`,
    [now, limit, RECHECK_MS]);
  const result: ReconcileResult = { claimed: rows.length, confirmed: 0, refundPending: 0, expired: 0, errors: 0 };
  const count = (r: "confirmed" | "already" | "refund_pending") => {
    if (r === "confirmed") result.confirmed += 1;
    if (r === "refund_pending") result.refundPending += 1;
  };
  const holdLapsed = (row: DueRow) => row.booking_status === "pending_payment" && row.hold_expires_at !== null && row.hold_expires_at <= now;
  const setError = (row: DueRow, message: string) =>
    pool.query("update payments set last_error = $2, updated_at = $3 where booking_id = $1 and status = 'pending'", [row.booking_id, message.slice(0, 500), now]);

  for (const row of rows) {
    try {
      const auth = await deps.authFor(row.host_id);
      if (!auth) {
        await setError(row, "Razorpay disconnected");
        // Nobody can pay without the host's account, so a lapsed hold still frees its slot.
        if (holdLapsed(row) && await expireHold(pool, row.booking_id, now)) result.expired += 1;
        continue;
      }
      const orders = deps.ordersFor(auth);
      const items = await orders.orderPayments(row.provider_order_id);
      const captured = items.find((p) => p.status === "captured");
      const authorized = items.find((p) => p.status === "authorized");
      if (captured) {
        count(await applyCapturedPayment(pool, row.booking_id, captured.id, now));
      } else if (authorized) {
        const p = await orders.capture(authorized.id, authorized.amount, authorized.currency);
        count(await applyCapturedPayment(pool, row.booking_id, p.id, now));
      } else if (holdLapsed(row)) {
        if (await expireHold(pool, row.booking_id, now)) result.expired += 1;
      } else if (row.booking_status === "cancelled" && row.cancelled_at && now.getTime() - row.cancelled_at.getTime() > LATE_PAYMENT_MS) {
        // Long enough after the cancel that no payment is still coming.
        await pool.query("update payments set status = 'failed', updated_at = $2 where booking_id = $1 and status = 'pending'", [row.booking_id, now]);
      }
    } catch (error) {
      // One host's failing account must not stop the others; the row stays pending and is retried next round.
      result.errors += 1;
      await setError(row, (error as Error).message ?? String(error)).catch(() => undefined);
    }
  }
  return result;
}
