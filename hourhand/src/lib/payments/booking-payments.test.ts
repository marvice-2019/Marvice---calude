// Paid bookings against real Postgres and a fake Razorpay (only with TEST_DATABASE_URL; uses its own database <name>_bp,
// dropped and recreated on every run).
import { closeAccount } from "../data/account-lifecycle";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "../data/pg-store";
import { SlotTakenError, type DataStore, type EventType, type User } from "../data/types";
import { freeSlots, handleCreateBooking, type PaymentDeps } from "../booking";
import type { Plan } from "../billing/plans";
import { handleConfirmPayment } from "./confirm-handler";
import { keyPairAuth } from "./host-razorpay";
import { razorpayOrders } from "./razorpay-orders";
import { applyCapturedPayment, confirmPayment, HOLD_MINUTES, PaymentStartError, PaymentVerifyError, reconcilePayments, startPaidBooking } from "./booking-payments";

const BASE = process.env.TEST_DATABASE_URL;
const auth = keyPairAuth("rzp_test_abcdefgh12", "k");
const sign = (order: string, payment: string) => createHmac("sha256", "k").update(`${order}|${payment}`).digest("hex");

interface FakePayment { id: string; order_id: string; amount: number; currency: string; status: string }

/** Razorpay's orders and payments endpoints, enough for start, confirm and the reconciler. */
function fakeRazorpay() {
  const state = { creates: 0, failCreate: false, failOrderPayments: false, onOrderPayments: null as null | (() => Promise<void>), payments: new Map<string, FakePayment>() };
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
    const o = /^\/v1\/orders\/([^/]+)\/payments$/.exec(path);
    if (o && method === "GET") {
      if (state.failOrderPayments) return json({ error: { code: "SERVER_ERROR", description: "orders down" } }, 503);
      await state.onOrderPayments?.();
      return json({ items: [...state.payments.values()].filter((p) => p.order_id === decodeURIComponent(o[1])) });
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
  it("closing the host's account releases a held booking (checked inside a rolled-back transaction)", async () => {
    const fake = fakeRazorpay();
    const r = await startPaidBooking({ pool, store, auth, orders: fake.orders }, input(), new Date());
    const client = await pool.connect();
    try {
      await client.query("begin");
      await closeAccount(client, r.booking.hostId, new Date());
      const { rows: [b] } = await client.query("select status, hold_expires_at, cancelled_by from bookings where id = $1", [r.booking.id]);
      expect(b).toMatchObject({ status: "cancelled", hold_expires_at: null, cancelled_by: "system" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  describe("reconciler", () => {
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    const run = (fake: ReturnType<typeof fakeRazorpay>, now: Date) =>
      reconcilePayments({ pool, authFor: async () => auth, ordersFor: () => fake.orders }, now, 100);
    /** A held booking whose guest never came back to our page; `pay` is what Razorpay holds for its order, if anything. */
    async function abandoned(fake = fakeRazorpay(), o: Partial<FakePayment> | null = null) {
      const r = await startPaidBooking({ pool, store, auth, orders: fake.orders }, input(), new Date());
      const pay = o && { id: `pay_${Math.random().toString(36).slice(2, 10)}`, order_id: r.payment!.orderId, amount: 50_000, currency: "INR", status: "captured", ...o };
      if (pay) fake.state.payments.set(pay.id, pay);
      return { fake, id: r.booking.id, pay, startAt: r.booking.startAt };
    }

    // Each test counts only its own rows: settle whatever earlier tests left pending.
    beforeEach(async () => {
      await pool.query("update payments set status = 'failed' where status = 'pending'");
    });

    it("confirms a guest who paid and closed the tab", async () => {
      const { fake, id, pay } = await abandoned(undefined, {});
      expect(await run(fake, later(2))).toMatchObject({ claimed: 1, confirmed: 1, errors: 0 });
      expect(await booking(id)).toMatchObject({ status: "confirmed", hold_expires_at: null });
      expect((await payment(id))[0]).toMatchObject({ status: "paid", provider_payment_id: pay!.id });
      expect(await notifications(id)).toBeGreaterThan(0);
    });

    it("captures an authorized payment and confirms", async () => {
      const { fake, id, pay } = await abandoned(undefined, { status: "authorized" });
      expect(await run(fake, later(2))).toMatchObject({ claimed: 1, confirmed: 1 });
      expect(fake.state.payments.get(pay!.id)!.status).toBe("captured");
      expect(await booking(id)).toMatchObject({ status: "confirmed" });
    });

    it("expires an unpaid hold past its time and frees the slot", async () => {
      const { fake, id, startAt } = await abandoned();
      expect(await run(fake, later(HOLD_MINUTES + 1))).toMatchObject({ claimed: 1, expired: 1 });
      const { rows } = await pool.query("select status, cancelled_by, cancel_reason, hold_expires_at from bookings where id = $1", [id]);
      expect(rows[0]).toMatchObject({ status: "cancelled", cancelled_by: "system", cancel_reason: "Payment not completed", hold_expires_at: null });
      expect((await payment(id))[0]).toMatchObject({ status: "failed" });
      // The hold hasn't lapsed by the database clock, so only the reconciler can have freed the slot.
      const again = await startPaidBooking({ pool, store, auth, orders: fake.orders }, input({ startAt }), new Date());
      expect(again.booking.status).toBe("pending_payment");
    });

    it("leaves an unpaid hold alone while it is still running", async () => {
      const { fake, id } = await abandoned();
      expect(await run(fake, later(2))).toMatchObject({ claimed: 1, confirmed: 0, expired: 0 });
      await unchanged(id);
    });

    it("an expiring hold doesn't cancel a booking confirmed while Razorpay was being asked", async () => {
      const { fake, id } = await abandoned();
      fake.state.onOrderPayments = async () => { await applyCapturedPayment(pool, id, "pay_from_checkout", new Date()); };
      expect(await run(fake, later(HOLD_MINUTES + 1))).toMatchObject({ claimed: 1, expired: 0 });
      expect(await booking(id)).toMatchObject({ status: "confirmed" });
      expect((await payment(id))[0]).toMatchObject({ status: "paid" });
    });

    it("an API error on one host leaves that row pending and still settles another host's", async () => {
      const broken = fakeRazorpay();
      broken.state.failOrderPayments = true;
      const working = fakeRazorpay();
      const arunAuth = keyPairAuth("rzp_test_arun1234ab", "k2");
      const arun = (await store.getUserBySlug("arun"))!;
      const arunEvent = (await store.listEventTypes(arun.id))[0].id;
      const a = await abandoned(broken);
      const b = await startPaidBooking({ pool, store, auth: arunAuth, orders: working.orders }, { ...input(), eventTypeId: arunEvent }, new Date());
      const pay = { id: "pay_arun_1", order_id: b.payment!.orderId, amount: 50_000, currency: "INR", status: "captured" };
      working.state.payments.set(pay.id, pay);
      const r = await reconcilePayments({ pool, authFor: async (hostId) => (hostId === arun.id ? arunAuth : auth), ordersFor: (x) => (x === arunAuth ? working.orders : broken.orders) }, later(2));
      expect(r).toMatchObject({ claimed: 2, confirmed: 1, errors: 1 });
      expect((await payment(a.id))[0]).toMatchObject({ status: "pending", last_error: expect.stringContaining("orders down") });
      expect(await booking(b.booking.id)).toMatchObject({ status: "confirmed" });
    });

    it("a payment captured after the system cancelled the booking is marked for refund", async () => {
      const { fake, id, pay } = await abandoned(undefined, {});
      await pool.query(`update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancel_reason = 'Payment not completed', hold_expires_at = null
        where id = $1`, [id]);
      expect(await run(fake, later(2))).toMatchObject({ claimed: 1, refundPending: 1 });
      expect(await booking(id)).toMatchObject({ status: "cancelled" });
      expect((await payment(id))[0]).toMatchObject({ status: "refund_pending", provider_payment_id: pay!.id });
    });

    it("doesn't check a payment again within a minute", async () => {
      const { fake, id } = await abandoned();
      const first = later(2);
      expect(await run(fake, first)).toMatchObject({ claimed: 1 });
      expect(await run(fake, new Date(first.getTime() + 30_000))).toMatchObject({ claimed: 0 });
      expect(await run(fake, new Date(first.getTime() + 61_000))).toMatchObject({ claimed: 1 });
      await unchanged(id);
    });
  });
  describe("booking routes", () => {
    const now = () => new Date();
    let et: EventType;
    const setPrice = async (minor: number | null) => {
      await pool.query("update event_types set price_minor = $2, currency = $3 where id = $1", [eventTypeId, minor, minor === null ? null : "INR"]);
      et = (await store.listEventTypes(priya.id)).find((e) => e.id === eventTypeId)!;
    };
    const deps = (fake = fakeRazorpay(), o: { plan?: Plan; connected?: boolean } = {}): PaymentDeps =>
      ({ pool, authFor: async () => (o.connected === false ? null : auth), ordersFor: () => fake.orders, planFor: async () => o.plan ?? "solo" });
    /** A booking request for the next time the engine offers, with every required question answered. */
    async function request(key = randomUUID()) {
      const start = (await freeSlots(store, priya, et, now(), new Date(Date.now() + 14 * 86_400_000), now()))[0];
      const questions = await store.listCustomQuestions(priya.id, eventTypeId);
      const answers = Object.fromEntries(questions.filter((q) => q.required).map((q) => [q.id, "yes"]));
      return { slug: "priya", event: et.slug, start: start.toISOString(), name: "Asha", email: "asha@example.in", timezone: "Asia/Kolkata", answers, idempotencyKey: key };
    }
    type Created = { bookingId: string; manageToken: string; payment: { orderId: string; holdExpiresAt: string } | null };

    beforeEach(() => setPrice(50_000));
    afterAll(() => setPrice(null));

    it("refuses a priced event when the host is on Free, has no Razorpay, or payments aren't set up", async () => {
      const req = await request();
      expect(await handleCreateBooking(store, req, now(), undefined, deps(undefined, { plan: "free" }))).toEqual({ status: 409, body: { error: "payments_unavailable" } });
      expect(await handleCreateBooking(store, req, now(), undefined, deps(undefined, { connected: false }))).toEqual({ status: 409, body: { error: "payments_unavailable" } });
      expect(await handleCreateBooking(store, req, now(), undefined, null)).toEqual({ status: 409, body: { error: "payments_unavailable" } });
      expect((await store.listBookings(priya.id)).some((b) => b.idempotencyKey === req.idempotencyKey)).toBe(false);
    });

    it("holds a priced booking and returns its payment; a repeat returns the same order", async () => {
      const fake = fakeRazorpay();
      const req = await request();
      const first = await handleCreateBooking(store, req, now(), undefined, deps(fake));
      expect(first.status).toBe(201);
      const body = first.body as Created;
      expect(body.payment).toMatchObject({ keyId: auth.keyId, amount: 50_000, currency: "INR" });
      expect(new Date(body.payment!.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());
      expect((await booking(body.bookingId)).status).toBe("pending_payment");
      const again = await handleCreateBooking(store, req, now(), undefined, deps(fake));
      expect(again.status).toBe(200);
      expect((again.body as Created).payment!.orderId).toBe(body.payment!.orderId);
      expect(fake.state.creates).toBe(1);
    });

    it("answers 502 when the order can't be created", async () => {
      const fake = fakeRazorpay();
      fake.state.failCreate = true;
      expect(await handleCreateBooking(store, await request(), now(), undefined, deps(fake))).toEqual({ status: 502, body: { error: "payment_unavailable" } });
    });

    it("confirms a good payment by manage token, and rejects a bad signature or unknown token", async () => {
      const fake = fakeRazorpay();
      const body = (await handleCreateBooking(store, await request(), now(), undefined, deps(fake))).body as Created;
      const pay: FakePayment = { id: "pay_route1", order_id: body.payment!.orderId, amount: 50_000, currency: "INR", status: "captured" };
      fake.state.payments.set(pay.id, pay);
      const d = deps(fake);
      expect(await handleConfirmPayment(store, d, { manageToken: body.manageToken, paymentId: pay.id, signature: "nope" }, now()))
        .toEqual({ status: 400, body: { error: "bad_signature" } });
      expect(await handleConfirmPayment(store, d, { manageToken: "no-such-token", paymentId: pay.id, signature: sign(pay.order_id, pay.id) }, now()))
        .toEqual({ status: 404, body: { error: "not_found" } });
      expect(await handleConfirmPayment(store, d, { manageToken: body.manageToken, paymentId: 5 }, now())).toMatchObject({ status: 400 });
      expect(await handleConfirmPayment(store, d, { manageToken: body.manageToken, paymentId: pay.id, signature: sign(pay.order_id, pay.id) }, now()))
        .toEqual({ status: 200, body: { status: "confirmed" } });
      expect((await booking(body.bookingId)).status).toBe("confirmed");
    });

    it("a free event still books and confirms straight away, with or without payments", async () => {
      await setPrice(null);
      const r = await handleCreateBooking(store, await request(), now(), undefined, deps(undefined, { plan: "free" }));
      expect(r.status).toBe(201);
      expect((r.body as Created).payment).toBeUndefined();
      expect((await booking((r.body as Created).bookingId)).status).toBe("confirmed");
    });
  });
});
