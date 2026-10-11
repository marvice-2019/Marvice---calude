import type pg from "pg";
import { BillingApiError } from "../billing/providers";
import { NotFoundError } from "../data/types";
import { parsePrice, PRICE_INVALID } from "../event-types";
import { kickJobs } from "../jobs/kick";
import { invoiceForPurchase } from "../gst/invoices";
import type { PaymentCheckDeps } from "../payments/booking-payments";
import type { HostRazorpayAuth } from "../payments/host-razorpay";
import type { RazorpayOrders, RazorpayPayment } from "../payments/razorpay-orders";

// Session packages: a host sells N sessions of one event type for one price, paid once into the host's own Razorpay
// account. The buyer gets a private link (/p/<token>) to book them. Credits are never stored: a credit is used by a
// booking made with the purchase that isn't cancelled, so a cancel gives it back and nothing can drift.

type Db = Pick<pg.Pool, "query">;
const CURRENCY = "INR";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{48}$/;
const DAY = 86_400_000;

export const PACKAGE_LIMITS = { sessions: { min: 2, max: 50 }, validDays: { min: 7, max: 730 } } as const;

export interface Package {
  id: string;
  userId: string;
  eventTypeId: string;
  name: string;
  sessions: number;
  priceMinor: number;
  validDays: number;
  active: boolean;
  createdAt: Date;
}

export interface PackagePurchase {
  id: string;
  packageId: string;
  hostId: string;
  eventTypeId: string;
  sessions: number;
  priceMinor: number;
  validDays: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  token: string;
  status: "pending" | "paid" | "failed";
  paidAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  /** Sessions booked with it and not cancelled. */
  used: number;
}

export interface PackageInput { eventTypeId: string; name: string; sessions: number; priceMinor: number; validDays: number }

/** Why a package can't book: unknown link, not paid yet, past its end date, all sessions booked, or for another event type. */
export type PackageRefusal = "not_found" | "unpaid" | "expired" | "used_up" | "wrong_event";

export class PackageUnavailableError extends Error {
  constructor(readonly reason: PackageRefusal) {
    super(`Package can't book: ${reason}`);
    this.name = "PackageUnavailableError";
  }
}

const PACKAGE = "id, user_id, event_type_id, name, sessions, price_minor, valid_days, active, created_at";
const toPackage = (r: Record<string, unknown>): Package => ({
  id: r.id as string, userId: r.user_id as string, eventTypeId: r.event_type_id as string, name: r.name as string, sessions: r.sessions as number,
  priceMinor: r.price_minor as number, validDays: r.valid_days as number, active: r.active as boolean, createdAt: r.created_at as Date,
});

const PURCHASE = `select p.id, p.package_id, p.host_id, p.event_type_id, p.sessions, p.price_minor, p.valid_days, p.guest_name, p.guest_email, p.guest_phone,
  p.token, p.status, p.paid_at, p.expires_at, p.created_at,
  (select count(*)::int from bookings b where b.package_purchase_id = p.id and b.status <> 'cancelled') as used
  from package_purchases p`;
const toPurchase = (r: Record<string, unknown>): PackagePurchase => ({
  id: r.id as string, packageId: r.package_id as string, hostId: r.host_id as string, eventTypeId: r.event_type_id as string,
  sessions: r.sessions as number, priceMinor: r.price_minor as number, validDays: r.valid_days as number, guestName: r.guest_name as string,
  guestEmail: r.guest_email as string, guestPhone: (r.guest_phone as string | null) ?? null, token: r.token as string,
  status: r.status as PackagePurchase["status"], paidAt: (r.paid_at as Date | null) ?? null, expiresAt: (r.expires_at as Date | null) ?? null,
  createdAt: r.created_at as Date, used: r.used as number,
});

/** Checks the host's package form. Price in rupees as typed; sessions and days as whole numbers. */
export function validatePackageForm(form: { eventTypeId: string; name: string; sessions: string; price: string; validDays: string }):
  { ok: true; value: PackageInput } | { ok: false; errors: Partial<Record<"eventTypeId" | "name" | "sessions" | "price" | "validDays", string>> } {
  const errors: Partial<Record<"eventTypeId" | "name" | "sessions" | "price" | "validDays", string>> = {};
  const whole = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);
  const name = form.name.trim();
  if (!UUID.test(form.eventTypeId)) errors.eventTypeId = "Pick the event type the sessions are for.";
  if (name.length < 1 || name.length > 100) errors.name = "Give it a name, up to 100 characters.";
  const sessions = whole(form.sessions);
  const { sessions: s, validDays: d } = PACKAGE_LIMITS;
  if (sessions === null || sessions < s.min || sessions > s.max) errors.sessions = `Enter ${s.min} to ${s.max} sessions.`;
  const price = parsePrice(form.price);
  if (price === "invalid" || price === null) errors.price = PRICE_INVALID;
  const validDays = whole(form.validDays);
  if (validDays === null || validDays < d.min || validDays > d.max) errors.validDays = `Enter ${d.min} to ${d.max} days.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { eventTypeId: form.eventTypeId, name, sessions: sessions!, priceMinor: price as number, validDays: validDays! } };
}

export async function listPackages(db: Db, hostId: string): Promise<Package[]> {
  if (!UUID.test(hostId)) return [];
  return (await db.query(`select ${PACKAGE} from packages where user_id = $1 order by created_at`, [hostId])).rows.map(toPackage);
}

/** Only for one of the host's own active, bookable (not one-off) event types; anything else is NotFound. */
export async function createPackage(db: Db, hostId: string, input: PackageInput): Promise<Package> {
  if (!UUID.test(hostId) || !UUID.test(input.eventTypeId)) throw new NotFoundError("Event type");
  const { rows } = await db.query(
    `insert into packages (user_id, event_type_id, name, sessions, price_minor, valid_days)
     select $1, e.id, $3, $4, $5, $6 from event_types e where e.id = $2 and e.user_id = $1 and e.active and e.kind = 'one_on_one'
     returning ${PACKAGE}`, [hostId, input.eventTypeId, input.name, input.sessions, input.priceMinor, input.validDays]);
  if (!rows[0]) throw new NotFoundError("Event type");
  return toPackage(rows[0]);
}

/** Turning a package off stops new sales; what people already bought keeps working. */
export async function setPackageActive(db: Db, hostId: string, packageId: string, active: boolean): Promise<void> {
  if (!UUID.test(hostId) || !UUID.test(packageId)) throw new NotFoundError("Package");
  const { rowCount } = await db.query("update packages set active = $3 where id = $1 and user_id = $2", [packageId, hostId, active]);
  if (!rowCount) throw new NotFoundError("Package");
}

export interface PublicPackage { pkg: Package; host: { id: string; name: string; slug: string }; eventType: { name: string; slug: string; durationMinutes: number } }

/** A package someone can buy now: on sale, its event type still bookable, its host's account open. */
export async function publicPackage(db: Db, packageId: string): Promise<PublicPackage | null> {
  if (!UUID.test(packageId)) return null;
  const { rows: [r] } = await db.query(
    `select ${PACKAGE.split(", ").map((c) => `k.${c}`).join(", ")}, u.name as host_name, u.slug as host_slug, e.name as event_name, e.slug as event_slug, e.duration_minutes
     from packages k join users u on u.id = k.user_id join event_types e on e.id = k.event_type_id
     where k.id = $1 and k.active and e.active and e.kind = 'one_on_one' and u.deleted_at is null`, [packageId]);
  if (!r) return null;
  return { pkg: toPackage(r), host: { id: r.user_id, name: r.host_name, slug: r.host_slug }, eventType: { name: r.event_name, slug: r.event_slug, durationMinutes: r.duration_minutes } };
}

/** The host's own active packages for one event type, for the "or buy a package" line on its booking page. */
export async function packagesForEventType(db: Db, hostId: string, eventTypeId: string): Promise<Package[]> {
  if (!UUID.test(hostId) || !UUID.test(eventTypeId)) return [];
  return (await db.query(`select ${PACKAGE} from packages where user_id = $1 and event_type_id = $2 and active order by sessions`, [hostId, eventTypeId])).rows.map(toPackage);
}

export async function purchaseByToken(db: Db, token: string): Promise<PackagePurchase | null> {
  if (!TOKEN.test(token)) return null;
  const { rows: [r] } = await db.query(`${PURCHASE} where p.token = $1`, [token]);
  return r ? toPurchase(r) : null;
}

/** The sessions booked with a purchase, cancelled ones included, soonest first. */
export async function purchaseSessions(db: Db, purchaseId: string): Promise<{ id: string; startAt: Date; status: string; manageToken: string; timezone: string }[]> {
  if (!UUID.test(purchaseId)) return [];
  const { rows } = await db.query(
    `select b.id, b.start_at, b.status, i.manage_token, i.timezone from bookings b join invitees i on i.booking_id = b.id
     where b.package_purchase_id = $1 order by b.start_at`, [purchaseId]);
  return rows.map((r) => ({ id: r.id, startAt: r.start_at, status: r.status, manageToken: r.manage_token, timezone: r.timezone }));
}

export async function listPurchases(db: Db, hostId: string): Promise<PackagePurchase[]> {
  if (!UUID.test(hostId)) return [];
  return (await db.query(`${PURCHASE} where p.host_id = $1 and p.status = 'paid' order by p.paid_at desc`, [hostId])).rows.map(toPurchase);
}

/** What the browser needs to open Razorpay Checkout for a purchase. */
export interface PurchaseCheckout { orderId: string; keyId: string; amount: number; currency: string }

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

export class PurchaseStartError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "PurchaseStartError";
  }
}

/**
 * Starts a purchase: a pending row and a Razorpay order on the host's account. A repeat of the same request (same key)
 * returns the same purchase and order, so a retry never makes a second order. The token is returned so the browser can
 * confirm and then open the buyer's page; it books nothing until the payment is confirmed.
 */
export async function startPurchase(
  deps: { pool: pg.Pool; auth: HostRazorpayAuth; orders: RazorpayOrders },
  input: { packageId: string; name: string; email: string; phone: string | null; idempotencyKey: string },
): Promise<{ token: string; status: PackagePurchase["status"]; payment: PurchaseCheckout | null }> {
  const { pool, auth, orders } = deps;
  const found = await publicPackage(pool, input.packageId);
  if (!found) throw new NotFoundError("Package");
  const { pkg } = found;
  const { rows: [row] } = await pool.query(
    `insert into package_purchases (package_id, host_id, event_type_id, sessions, price_minor, valid_days, guest_name, guest_email, guest_phone, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (idempotency_key) do update set updated_at = package_purchases.updated_at
     returning id, package_id, token, status, provider_order_id, price_minor`,
    [pkg.id, pkg.userId, pkg.eventTypeId, pkg.sessions, pkg.priceMinor, pkg.validDays, input.name, input.email, input.phone, input.idempotencyKey]);
  // The same key for another package is somebody's mistake, not a retry.
  if (row.package_id !== pkg.id) throw new NotFoundError("Package");
  const checkout = (orderId: string): PurchaseCheckout => ({ orderId, keyId: auth.keyId, amount: row.price_minor, currency: CURRENCY });
  if (row.status !== "pending") return { token: row.token, status: row.status, payment: null };
  if (row.provider_order_id) return { token: row.token, status: row.status, payment: checkout(row.provider_order_id) };

  // The row stays locked while the order is made, so a concurrent repeat waits and then reuses this order.
  const orderId = await inTx(pool, async (client) => {
    const { rows: [locked] } = await client.query("select provider_order_id from package_purchases where id = $1 for update", [row.id]);
    if (locked.provider_order_id) return locked.provider_order_id as string;
    let order;
    try {
      order = await orders.createOrder({ amount: row.price_minor, currency: CURRENCY, receipt: `pkg-${row.id}`, notes: { package_purchase_id: row.id } });
    } catch (error) {
      throw new PurchaseStartError(`Payment could not start: ${(error as Error).message}`, error instanceof BillingApiError && error.retryable);
    }
    await client.query("update package_purchases set provider_order_id = $2, updated_at = now() where id = $1", [row.id, order.id]);
    return order.id;
  });
  return { token: row.token, status: "pending", payment: checkout(orderId) };
}

/**
 * Marks a purchase paid from a captured payment and queues the buyer's and host's emails. A purchase already paid (the
 * reconciler or the browser got there first) is left as it is.
 */
export async function applyPurchasePayment(pool: pg.Pool, purchaseId: string, razorpayPaymentId: string, now: Date): Promise<"paid" | "already"> {
  const result = await inTx(pool, async (client) => {
    const { rows: [p] } = await client.query(
      "select p.status, p.valid_days, p.host_id, p.guest_email, u.email as host_email from package_purchases p join users u on u.id = p.host_id where p.id = $1 for update of p",
      [purchaseId]);
    if (!p) throw new Error(`Package purchase ${purchaseId} not found`);
    if (p.status === "paid") return "already" as const;
    // A purchase marked failed (no payment seen for a day) still becomes paid if the money did arrive.
    await client.query(
      `update package_purchases set status = 'paid', provider_payment_id = $2, paid_at = $3, expires_at = $4, last_error = null, updated_at = $3 where id = $1`,
      [purchaseId, razorpayPaymentId, now, new Date(now.getTime() + p.valid_days * DAY)]);
    await invoiceForPurchase(client, purchaseId, now);
    for (const [kind, to] of [["package_guest", p.guest_email], ["package_host", p.host_email]]) {
      await client.query(
        `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
         values (null, $1, 'email', $2, $3, $4, $5) on conflict (dedupe_key) do nothing`,
        [p.host_id, kind, to, now, `purchase:${purchaseId}:${kind}`]);
    }
    return "paid" as const;
  });
  if (result === "paid") kickJobs();
  return result;
}

export type PurchaseVerifyReason = "no_payment" | "bad_signature" | "mismatch" | "not_paid";

export class PurchaseVerifyError extends Error {
  constructor(readonly reason: PurchaseVerifyReason) {
    super(`Purchase payment could not be verified: ${reason}`);
    this.name = "PurchaseVerifyError";
  }
}

async function captureOnce(orders: RazorpayOrders, paymentId: string, amount: number, currency: string): Promise<RazorpayPayment> {
  try {
    return await orders.capture(paymentId, amount, currency);
  } catch (error) {
    const again = await orders.getPayment(paymentId);
    if (again.status === "captured") return again;
    throw error;
  }
}

/**
 * Confirms a purchase from what Checkout handed the browser. Order and amount come from our own row, never the client,
 * so a payment for another order or a smaller amount can't pay for this package.
 */
export async function confirmPurchase(
  deps: { pool: pg.Pool; auth: HostRazorpayAuth; orders: RazorpayOrders },
  input: { token: string; paymentId: string; signature: string },
  now: Date,
): Promise<"paid" | "already"> {
  const { pool, auth, orders } = deps;
  const { rows: [row] } = TOKEN.test(input.token)
    ? await pool.query("select id, provider_order_id, price_minor, currency from package_purchases where token = $1", [input.token])
    : { rows: [] };
  if (!row?.provider_order_id) throw new PurchaseVerifyError("no_payment");
  if (!auth.verifyPaymentSignature(row.provider_order_id, input.paymentId, input.signature)) throw new PurchaseVerifyError("bad_signature");
  let p = await orders.getPayment(input.paymentId);
  if (p.orderId !== row.provider_order_id || p.amount !== row.price_minor || p.currency !== row.currency) throw new PurchaseVerifyError("mismatch");
  if (p.status === "authorized") p = await captureOnce(orders, p.id, row.price_minor, row.currency);
  if (p.status !== "captured") throw new PurchaseVerifyError("not_paid");
  return applyPurchasePayment(pool, row.id, p.id, now);
}

// A purchase is checked once it is a minute old and at most once a minute; with no payment for a day it is marked failed.
const RECHECK_MS = 60_000;
const GIVE_UP_MS = DAY;

export interface PurchaseReconcileResult { claimed: number; paid: number; failed: number; errors: number }

/** Settles pending purchases with Razorpay: a buyer who paid and closed the tab, a payment only authorized, or none at all. */
export async function reconcilePurchases(deps: PaymentCheckDeps & { pool: pg.Pool }, now: Date, limit = 20): Promise<PurchaseReconcileResult> {
  const { pool } = deps;
  const { rows } = await pool.query(
    `with due as (
       select id from package_purchases
       where status = 'pending' and created_at < $1::timestamptz - $3 * interval '1 millisecond'
         and (checked_at is null or checked_at < $1::timestamptz - $3 * interval '1 millisecond')
       order by checked_at nulls first, created_at limit $2 for update skip locked)
     update package_purchases p set checked_at = $1 from due where p.id = due.id
     returning p.id, p.host_id, p.provider_order_id, p.price_minor, p.currency, p.created_at`, [now, limit, RECHECK_MS]);
  const result: PurchaseReconcileResult = { claimed: rows.length, paid: 0, failed: 0, errors: 0 };
  const giveUp = async (r: { id: string; created_at: Date }) => {
    if (now.getTime() - new Date(r.created_at).getTime() <= GIVE_UP_MS) return;
    await pool.query("update package_purchases set status = 'failed', updated_at = $2 where id = $1 and status = 'pending'", [r.id, now]);
    result.failed += 1;
  };
  for (const r of rows) {
    try {
      // Its order never got made: nothing can be paid, so it just times out.
      if (!r.provider_order_id) { await giveUp(r); continue; }
      const auth = await deps.authFor(r.host_id);
      if (!auth) {
        await pool.query("update package_purchases set last_error = 'Razorpay disconnected', updated_at = $2 where id = $1", [r.id, now]);
        await giveUp(r);
        continue;
      }
      const orders = deps.ordersFor(auth);
      const items = await orders.orderPayments(r.provider_order_id);
      // Amounts from our own row, never Razorpay's word alone.
      const ours = (p: RazorpayPayment) => p.amount === r.price_minor && p.currency === r.currency;
      const captured = items.find((p) => p.status === "captured" && ours(p));
      const authorized = items.find((p) => p.status === "authorized" && ours(p));
      const paid = captured ?? (authorized ? await captureOnce(orders, authorized.id, r.price_minor, r.currency) : null);
      if (paid?.status === "captured") {
        if ((await applyPurchasePayment(pool, r.id, paid.id, now)) === "paid") result.paid += 1;
      } else {
        await giveUp(r);
      }
    } catch (error) {
      result.errors += 1;
      await pool.query("update package_purchases set last_error = $2, updated_at = $3 where id = $1", [r.id, ((error as Error).message ?? String(error)).slice(0, 500), now]).catch(() => undefined);
    }
  }
  return result;
}

/**
 * Inside a booking's transaction: locks the purchase and checks it can pay for these sessions (paid, for this event type,
 * every start before its end date, enough sessions left). Returns the purchase id to record on the bookings.
 */
export async function takeCredits(client: Pick<pg.PoolClient, "query">, token: string, eventTypeId: string, starts: Date[]): Promise<string> {
  if (!TOKEN.test(token)) throw new PackageUnavailableError("not_found");
  const { rows: [p] } = await client.query(
    "select id, status, event_type_id, sessions, expires_at from package_purchases where token = $1 for update", [token]);
  if (!p) throw new PackageUnavailableError("not_found");
  if (p.status !== "paid") throw new PackageUnavailableError("unpaid");
  if (p.event_type_id !== eventTypeId) throw new PackageUnavailableError("wrong_event");
  if (starts.some((s) => s.getTime() >= new Date(p.expires_at).getTime())) throw new PackageUnavailableError("expired");
  const { rows: [{ used }] } = await client.query(
    "select count(*)::int as used from bookings where package_purchase_id = $1 and status <> 'cancelled'", [p.id]);
  if (used + starts.length > p.sessions) throw new PackageUnavailableError("used_up");
  return p.id as string;
}
