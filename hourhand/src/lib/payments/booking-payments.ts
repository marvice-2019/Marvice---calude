import type pg from "pg";
import { BillingApiError } from "../billing/providers";
import { queueBookingNotifications } from "../data/notifications";
import type { BookingWithInvitee, CreateBookingInput, DataStore } from "../data/types";
import { kickJobs } from "../jobs/kick";
import { creditNoteForRefund, invoiceForPayment } from "../gst/invoices";
import type { HostRazorpayAuth } from "./host-razorpay";
import type { RazorpayOrders, RazorpayPayment } from "./razorpay-orders";

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
  input: CreateBookingInput & { priceMinor: number; kind?: "payment" | "deposit" },
  now: Date,
): Promise<{ booking: BookingWithInvitee; payment: CheckoutPayment | null }> {
  const { pool, store, auth, orders } = deps;
  const { priceMinor, kind = "payment", ...bookingInput } = input;
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
       where id = $1 and status = 'pending_payment' and not exists (select 1 from payments where booking_id = $1)`, [booking.id, now]);
    throw new PaymentStartError(`Payment could not start: ${(error as Error).message}`, error instanceof BillingApiError && error.retryable);
  }
  const row = await inTx(pool, async (client) => {
    // Locked so two concurrent repeats of the request settle on one payment row.
    await client.query("select id from bookings where id = $1 for update", [booking.id]);
    const raced = await paymentFor(client, booking.id);
    if (raced) return raced;
    await client.query(
      `insert into payments (booking_id, host_id, provider, provider_order_id, amount_minor, currency, status, kind) values ($1, $2, 'razorpay', $3, $4, $5, 'pending', $6)`,
      [booking.id, booking.hostId, order.id, priceMinor, CURRENCY, kind]);
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
    const { rows: [paid] } = await client.query(
      "update payments set status = 'paid', provider_payment_id = $2, paid_at = $3, updated_at = $3 where booking_id = $1 returning id", [bookingId, razorpayPaymentId, now]);
    await queueBookingNotifications(client, bookingId, "booked", now);
    // A GST-registered host's guest gets a tax invoice with the payment (deposits aren't invoiced).
    if (paid) await invoiceForPayment(client, paid.id, now);
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
  if (p.status === "authorized") p = await captureOnce(orders, p.id, row.amount_minor, row.currency);
  if (p.status !== "captured") throw new PaymentVerifyError("not_paid");
  return applyCapturedPayment(pool, input.bookingId, p.id, now);
}

/**
 * Captures an authorized payment. Someone else may capture it at the same moment (the reconciler, the browser's confirm,
 * or the host's own auto-capture); Razorpay refuses the second call, so on failure read the payment again and carry on
 * if it is captured now.
 */
async function captureOnce(orders: RazorpayOrders, paymentId: string, amount: number, currency: string): Promise<RazorpayPayment> {
  try {
    return await orders.capture(paymentId, amount, currency);
  } catch (error) {
    const again = await orders.getPayment(paymentId);
    if (again.status === "captured") return again;
    throw error;
  }
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
    // The payment stays pending: a guest paying in the last seconds may still land, and the late-payment check below
    // finds it and refunds it. It is marked failed once the late window has passed.
    return (rowCount ?? 0) > 0;
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
  // Long enough after a system cancel that no payment is still coming.
  const pastLateWindow = (row: DueRow) => row.booking_status === "cancelled" && row.cancelled_at !== null && now.getTime() - row.cancelled_at.getTime() > LATE_PAYMENT_MS;
  const markFailed = (row: DueRow) =>
    pool.query("update payments set status = 'failed', updated_at = $2 where booking_id = $1 and status = 'pending'", [row.booking_id, now]);
  const setError = (row: DueRow, message: string) =>
    pool.query("update payments set last_error = $2, updated_at = $3 where booking_id = $1 and status = 'pending'", [row.booking_id, message.slice(0, 500), now]);

  for (const row of rows) {
    try {
      const auth = await deps.authFor(row.host_id);
      if (!auth) {
        await setError(row, "Razorpay disconnected");
        // Nobody can pay without the host's account, so a lapsed hold still frees its slot.
        if (holdLapsed(row) && await expireHold(pool, row.booking_id, now)) result.expired += 1;
        else if (pastLateWindow(row)) await markFailed(row);
        continue;
      }
      const orders = deps.ordersFor(auth);
      const items = await orders.orderPayments(row.provider_order_id);
      const captured = items.find((p) => p.status === "captured");
      const authorized = items.find((p) => p.status === "authorized");
      if (captured) {
        count(await applyCapturedPayment(pool, row.booking_id, captured.id, now));
      } else if (authorized) {
        const p = await captureOnce(orders, authorized.id, authorized.amount, authorized.currency);
        count(await applyCapturedPayment(pool, row.booking_id, p.id, now));
      } else if (holdLapsed(row)) {
        if (await expireHold(pool, row.booking_id, now)) result.expired += 1;
      } else if (pastLateWindow(row)) {
        await markFailed(row);
      }
    } catch (error) {
      // One host's failing account must not stop the others; the row stays pending and is retried next round.
      result.errors += 1;
      await setError(row, (error as Error).message ?? String(error)).catch(() => undefined);
    }
  }
  return result;
}

/** How long after a session ends the host has to mark a no-show before the guest's deposit goes back. */
export const DEPOSIT_HOLD_MS = 24 * 60 * 60_000;

/**
 * Deposits whose session ended over a day ago with no no-show marked: queued for a full refund (processRefunds does it).
 * A deposit kept for a no-show stays paid. Returns how many were released.
 */
export async function releaseDeposits(pool: pg.Pool, now: Date, limit = 50): Promise<number> {
  const { rowCount } = await pool.query(
    `update payments p set status = 'refund_pending', checked_at = null, updated_at = $1
     where p.id in (
       select p2.id from payments p2 join bookings b on b.id = p2.booking_id join invitees i on i.booking_id = b.id
       where p2.kind = 'deposit' and p2.status = 'paid' and b.status = 'confirmed' and i.no_show_at is null
         and b.end_at < $1::timestamptz - $2 * interval '1 millisecond'
       limit $3 for update of p2 skip locked)`, [now, DEPOSIT_HOLD_MS, limit]);
  return rowCount ?? 0;
}

export interface RefundResult { claimed: number; refunded: number; errors: number }

interface RefundRow { id: string; booking_id: string; host_id: string; provider_payment_id: string }

// A refund that failed is retried at most every five minutes.
const REFUND_RETRY_MS = 5 * 60_000;

/**
 * Refunds payments marked refund_pending (a cancelled paid booking, or a payment that landed after the system cancelled
 * the booking), in full, on the host's own Razorpay account.
 */
export async function processRefunds(deps: PaymentCheckDeps & { pool: pg.Pool }, now: Date, limit = 10): Promise<RefundResult> {
  const { pool } = deps;
  const { rows } = await pool.query<RefundRow>(
    `with due as (
       select id from payments
       where provider = 'razorpay' and status = 'refund_pending'
         and (checked_at is null or checked_at < $1::timestamptz - $3 * interval '1 millisecond')
       order by checked_at nulls first, updated_at
       limit $2
       for update skip locked)
     update payments p set checked_at = $1 from due where p.id = due.id
     returning p.id, p.booking_id, p.host_id, p.provider_payment_id`,
    [now, limit, REFUND_RETRY_MS]);
  const result: RefundResult = { claimed: rows.length, refunded: 0, errors: 0 };
  const setError = (row: RefundRow, message: string) =>
    pool.query("update payments set last_error = $2, updated_at = $3 where id = $1 and status = 'refund_pending'", [row.id, message.slice(0, 500), now]);
  const markRefunded = async (row: RefundRow, refundId: string, amount: number) => {
    await inTx(pool, async (client) => {
      const { rowCount } = await client.query(
        "update payments set status = 'refunded', refund_id = $2, refunded_minor = $3, last_error = null, updated_at = $4 where id = $1 and status = 'refund_pending'",
        [row.id, refundId, amount, now]);
      // An invoiced payment refunded in full is reversed by a credit note, recorded with the refund.
      if (rowCount) await creditNoteForRefund(client, row.id, now);
    });
    result.refunded += 1;
  };

  for (const row of rows) {
    try {
      const auth = await deps.authFor(row.host_id);
      if (!auth) {
        await setError(row, "Razorpay disconnected");
        continue;
      }
      const orders = deps.ordersFor(auth);
      // An earlier attempt may have gone through before we could record it: never refund the same payment twice.
      const earlier = (await orders.listRefunds(row.provider_payment_id)).filter((r) => r.status !== "failed");
      if (earlier.length) {
        await markRefunded(row, earlier[0].id, earlier.reduce((sum, r) => sum + r.amount, 0));
        continue;
      }
      // The receipt is fixed per payment, so a repeat request is refused ("Duplicate receipt") and the next round
      // finds the refund in the list above. A refund Razorpay reports as pending has started and counts as done.
      const refund = await orders.refund(row.provider_payment_id, { receipt: `hh-${row.id}`, notes: { booking_id: row.booking_id } });
      await markRefunded(row, refund.id, refund.amount);
    } catch (error) {
      // One host's failing account must not stop the others; the row stays refund_pending and is retried later.
      result.errors += 1;
      await setError(row, (error as Error).message ?? String(error)).catch(() => undefined);
    }
  }
  return result;
}

export interface BookingPaymentSummary { amountMinor: number; status: "pending" | "paid" | "failed" | "refunded" | "refund_pending"; lastError: string | null; kind: "payment" | "deposit" }

/** The latest payment on one of the host's own bookings, for the host's dashboard. Another host's booking reads as null. */
export async function bookingPayment(db: Pick<pg.Pool, "query">, hostId: string, bookingId: string): Promise<BookingPaymentSummary | null> {
  const { rows: [p] } = await db.query(
    `select amount_minor, status, last_error, kind from payments where booking_id = $1 and host_id = $2 order by created_at desc limit 1`, [bookingId, hostId]);
  return p ? { amountMinor: p.amount_minor, status: p.status, lastError: p.last_error, kind: p.kind } : null;
}
