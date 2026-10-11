// Paid bookings against real Postgres and a fake Razorpay (only with TEST_DATABASE_URL; uses its own database <name>_bp,
// dropped and recreated on every run).
import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "../data/pg-store";
import { SlotTakenError, type DataStore, type User } from "../data/types";
import { keyPairAuth } from "./host-razorpay";
import { razorpayOrders } from "./razorpay-orders";
import { applyCapturedPayment, confirmPayment, PaymentStartError, PaymentVerifyError, startPaidBooking } from "./booking-payments";

const BASE = process.env.TEST_DATABASE_URL;
const auth = keyPairAuth("rzp_test_abcdefgh12", "k");
const sign = (order: string, payment: string) => createHmac("sha256", "k").update(`${order}|${payment}`).digest("hex");

interface FakePayment { id: string; order_id: string; amount: number; currency: string; status: string }

/** Razorpay's orders and payments endpoints, enough for start and confirm. */
function fakeRazorpay() {
  const state = { creates: 0, failCreate: false, payments: new Map<string, FakePayment>() };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    if (method === "POST" && path === "/v1/orders") {
      if (state.failCreate) return json({ error: { code: "SERVER_ERROR", description: "down" } }, 503);
      state.creates += 1;
      const body = JSON.parse(String(init.body));
      return json({ id: `order_${state.creates}_${Math.random().toString(36).slice(2, 8)}`, amount: body.amount, currency: body.currency, status: "created" });
    }
    const m = /^\/v1\/payments\/([^/]+)(\/capture)?$/.exec(path);
    const p = m && state.payments.get(decodeURIComponent(m[1]));
    if (!p) return json({ error: { code: "BAD_REQUEST_ERROR", description: "no such payment" } }, 400);
    if (m[2] && method === "POST") p.status = "captured";
    return json(p);
  }) as unknown as typeof fetch;
  return { state, orders: razorpayOrders(auth, { baseUrl: "https://rp.fake", fetchImpl }) };
}

describe.skipIf(!BASE)("paid bookings (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let eventTypeId: string;
  let slot = 0;
  // Each test books its own far-future slot, three hours apart so buffers never overlap.
  const nextStart = () => new Date(Date.UTC(2033, 0, 3, 0, 0) + slot++ * 3 * 3_600_000);
  const guest = { name: "Asha", email: "asha@example.in", timezone: "Asia/Kolkata", phone: null, answers: [] };
  const input = (o: { startAt?: Date; key?: string } = {}) =>
    ({ eventTypeId, startAt: o.startAt ?? nextStart(), idempotencyKey: o.key ?? `bp-${slot}-${Math.random()}`, invitee: guest, priceMinor: 50_000 });
  const booking = async (id: string) => (await pool.query("select status, hold_expires_at, cancelled_at from bookings where id = $1", [id])).rows[0];
  const payment = async (id: string) => (await pool.query("select * from payments where booking_id = $1", [id])).rows;
  const notifications = async (id: string) => Number((await pool.query("select count(*) from notifications where booking_id = $1", [id])).rows[0].count);
  /** A started booking plus a captured payment for its order, as Checkout would report it. */
  async function paid(fake = fakeRazorpay(), o: Partial<FakePayment> = {}) {
    const r = await startPaidBooking({ pool, store, auth, orders: fake.orders }, input(), new Date());
    const order = r.payment!.orderId;
    const pay: FakePayment = { id: `pay_${Math.random().toString(36).slice(2, 10)}`, order_id: order, amount: 50_000, currency: "INR", status: "captured", ...o };
    fake.state.payments.set(pay.id, pay);
    return { fake, r, order, pay, deps: { pool, auth, orders: fake.orders } };
  }

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_bp`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`drop database if exists ${name} with (force)`);
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    await migrate(u.toString());
    await seed(u.toString());
    pool = new pg.Pool({ connectionString: u.toString() });
    store = createPgStore(pool);
    priya = (await store.getUserBySlug("priya"))!;
    eventTypeId = (await store.listEventTypes(priya.id))[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("starts a held booking with one order on the host's account and no emails yet", async () => {
    const fake = fakeRazorpay();
    const r = await startPaidBooking({ pool, store, auth, orders: fake.orders }, input(), new Date());
    expect(r.booking.status).toBe("pending_payment");
    expect(r.payment).toMatchObject({ keyId: "rzp_test_abcdefgh12", amount: 50_000, currency: "INR", holdExpiresAt: r.booking.holdExpiresAt });
    expect(fake.state.creates).toBe(1);
    expect(await payment(r.booking.id)).toEqual([expect.objectContaining({ provider: "razorpay", provider_order_id: r.payment!.orderId, status: "pending", amount_minor: 50_000 })]);
    expect(await notifications(r.booking.id)).toBe(0);
  });

  it("a repeated request reuses the same order", async () => {
    const fake = fakeRazorpay();
    const req = input();
    const a = await startPaidBooking({ pool, store, auth, orders: fake.orders }, req, new Date());
    const b = await startPaidBooking({ pool, store, auth, orders: fake.orders }, req, new Date());
    expect(b.booking.id).toBe(a.booking.id);
    expect(b.payment!.orderId).toBe(a.payment!.orderId);
    expect(fake.state.creates).toBe(1);
    expect(await payment(a.booking.id)).toHaveLength(1);
  });

  it("frees the slot when the order can't be created", async () => {
    const fake = fakeRazorpay();
    fake.state.failCreate = true;
    const req = input();
    const err = await startPaidBooking({ pool, store, auth, orders: fake.orders }, req, new Date()).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentStartError);
    expect(err.retryable).toBe(true);
    const { rows } = await pool.query("select id, status, cancelled_by, cancel_reason, hold_expires_at from bookings where idempotency_key = $1", [req.idempotencyKey]);
    expect(rows[0]).toMatchObject({ status: "cancelled", cancelled_by: "system", cancel_reason: "Payment could not start", hold_expires_at: null });
    expect(await payment(rows[0].id)).toHaveLength(0);
  });

  it("a held slot can't be booked by someone else", async () => {
    const fake = fakeRazorpay();
    const startAt = nextStart();
    await startPaidBooking({ pool, store, auth, orders: fake.orders }, input({ startAt }), new Date());
    await expect(startPaidBooking({ pool, store, auth, orders: fake.orders }, input({ startAt }), new Date())).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("confirms a good payment: booking confirmed, payment paid, emails queued", async () => {
    const { r, pay, deps } = await paid();
    expect(await confirmPayment(deps, { bookingId: r.booking.id, paymentId: pay.id, signature: sign(r.payment!.orderId, pay.id) }, new Date())).toBe("confirmed");
    expect(await booking(r.booking.id)).toMatchObject({ status: "confirmed", hold_expires_at: null });
    expect((await payment(r.booking.id))[0]).toMatchObject({ status: "paid", provider_payment_id: pay.id, paid_at: expect.any(Date) });
    expect(await notifications(r.booking.id)).toBeGreaterThan(0);
  });

  const unchanged = async (bookingId: string) => {
    expect(await booking(bookingId)).toMatchObject({ status: "pending_payment" });
    expect((await payment(bookingId))[0]).toMatchObject({ status: "pending", provider_payment_id: null });
    expect(await notifications(bookingId)).toBe(0);
  };

  it("rejects a bad signature and changes nothing", async () => {
    const { r, pay, deps } = await paid();
    await expect(confirmPayment(deps, { bookingId: r.booking.id, paymentId: pay.id, signature: sign("order_other", pay.id) }, new Date()))
      .rejects.toMatchObject({ reason: "bad_signature" });
    await unchanged(r.booking.id);
  });

  it("rejects a payment for a different amount and changes nothing", async () => {
    const { r, pay, deps } = await paid(fakeRazorpay(), { amount: 100 });
    await expect(confirmPayment(deps, { bookingId: r.booking.id, paymentId: pay.id, signature: sign(r.payment!.orderId, pay.id) }, new Date()))
      .rejects.toMatchObject({ reason: "mismatch" });
    await unchanged(r.booking.id);
  });

  it("won't confirm a booking with a payment made for another booking's order", async () => {
    const fake = fakeRazorpay();
    const a = await paid(fake);
    const b = await paid(fake);
    // The client holds b's genuine payment and signature, and submits them for booking a.
    const err = await confirmPayment(a.deps, { bookingId: a.r.booking.id, paymentId: b.pay.id, signature: sign(b.order, b.pay.id) }, new Date()).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentVerifyError);
    await unchanged(a.r.booking.id);
    await unchanged(b.r.booking.id);
  });

  it("captures an authorized payment, then confirms", async () => {
    const { r, pay, deps, fake } = await paid(fakeRazorpay(), { status: "authorized" });
    expect(await confirmPayment(deps, { bookingId: r.booking.id, paymentId: pay.id, signature: sign(r.payment!.orderId, pay.id) }, new Date())).toBe("confirmed");
    expect(fake.state.payments.get(pay.id)!.status).toBe("captured");
    expect(await booking(r.booking.id)).toMatchObject({ status: "confirmed" });
  });

  it("rejects a payment that isn't paid, and an unknown booking", async () => {
    const { r, pay, deps } = await paid(fakeRazorpay(), { status: "failed" });
    await expect(confirmPayment(deps, { bookingId: r.booking.id, paymentId: pay.id, signature: sign(r.payment!.orderId, pay.id) }, new Date()))
      .rejects.toMatchObject({ reason: "not_paid" });
    await unchanged(r.booking.id);
    await expect(confirmPayment(deps, { bookingId: "00000000-0000-4000-8000-000000000000", paymentId: pay.id, signature: "x" }, new Date()))
      .rejects.toMatchObject({ reason: "no_payment" });
  });

  it("confirming twice is a no-op the second time", async () => {
    const { r, pay, deps } = await paid();
    const args = { bookingId: r.booking.id, paymentId: pay.id, signature: sign(r.payment!.orderId, pay.id) };
    expect(await confirmPayment(deps, args, new Date())).toBe("confirmed");
    const queued = await notifications(r.booking.id);
    expect(await confirmPayment(deps, args, new Date())).toBe("already");
    expect(await notifications(r.booking.id)).toBe(queued);
  });

  it("a payment for a booking cancelled meanwhile is marked for refund and the booking stays cancelled", async () => {
    const { r, pay, deps } = await paid();
    // The hold lapsed and was cleared the way the store expires holds.
    await pool.query(`update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancel_reason = 'Payment not completed', hold_expires_at = null
      where id = $1`, [r.booking.id]);
    expect(await confirmPayment(deps, { bookingId: r.booking.id, paymentId: pay.id, signature: sign(r.payment!.orderId, pay.id) }, new Date())).toBe("refund_pending");
    expect(await booking(r.booking.id)).toMatchObject({ status: "cancelled", cancelled_at: expect.any(Date) });
    expect((await payment(r.booking.id))[0]).toMatchObject({ status: "refund_pending", provider_payment_id: pay.id, paid_at: expect.any(Date) });
    expect(await applyCapturedPayment(pool, r.booking.id, pay.id, new Date())).toBe("refund_pending");
  });
});
