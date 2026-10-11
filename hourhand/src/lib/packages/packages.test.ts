// Session packages against real Postgres and a fake Razorpay (only with TEST_DATABASE_URL; uses its own database
// <name>_pkg, dropped and recreated on every run).
import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { handleCreateBooking, type PaymentDeps } from "../booking";
import type { Plan } from "../billing/plans";
import { createPgStore } from "../data/pg-store";
import type { DataStore, EventType, User } from "../data/types";
import { keyPairAuth } from "../payments/host-razorpay";
import { razorpayOrders } from "../payments/razorpay-orders";
import { processDueNotifications } from "../jobs/worker";
import type { Mail } from "../mail/mailer";
import { handleConfirmPurchase, handleStartPurchase } from "./handlers";
import {
  applyPurchasePayment, confirmPurchase, createPackage, purchaseByToken, PurchaseVerifyError, reconcilePurchases, startPurchase, validatePackageForm, type Package,
} from "./packages";

const BASE = process.env.TEST_DATABASE_URL;
const auth = keyPairAuth("rzp_test_abcdefgh12", "k");
const sign = (order: string, payment: string) => createHmac("sha256", "k").update(`${order}|${payment}`).digest("hex");
const DAY = 86_400_000;

interface FakePayment { id: string; order_id: string; amount: number; currency: string; status: string }

/** Razorpay's orders and payments endpoints, enough to start, confirm and reconcile a purchase. */
function fakeRazorpay() {
  const state = { creates: 0, payments: new Map<string, FakePayment>() };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    if (method === "POST" && path === "/v1/orders") {
      state.creates += 1;
      const body = JSON.parse(String(init.body));
      return json({ id: `order_pkg_${state.creates}_${Math.random().toString(36).slice(2, 8)}`, amount: body.amount, currency: body.currency, status: "created" });
    }
    const o = /^\/v1\/orders\/([^/]+)\/payments$/.exec(path);
    if (o) return json({ items: [...state.payments.values()].filter((p) => p.order_id === decodeURIComponent(o[1])) });
    const m = /^\/v1\/payments\/([^/]+)(\/capture)?$/.exec(path);
    const p = m && state.payments.get(decodeURIComponent(m[1]));
    if (!p) return json({ error: { code: "BAD_REQUEST_ERROR", description: "no such payment" } }, 400);
    if (m[2] && method === "POST") p.status = "captured";
    return json(p);
  }) as unknown as typeof fetch;
  return { state, orders: razorpayOrders(auth, { baseUrl: "https://rp.fake", fetchImpl }) };
}

describe("package form", () => {
  const form = { eventTypeId: "6f1c2d3e-0000-4000-8000-000000000001", name: "5 coaching sessions", sessions: "5", price: "4999", validDays: "90" };
  it("takes sessions, price in rupees and days, within limits", () => {
    expect(validatePackageForm(form)).toEqual({ ok: true, value: { eventTypeId: form.eventTypeId, name: "5 coaching sessions", sessions: 5, priceMinor: 499_900, validDays: 90 } });
    expect(validatePackageForm({ ...form, sessions: "1" })).toMatchObject({ ok: false, errors: { sessions: expect.any(String) } });
    expect(validatePackageForm({ ...form, sessions: "51" })).toMatchObject({ ok: false, errors: { sessions: expect.any(String) } });
    expect(validatePackageForm({ ...form, price: "" })).toMatchObject({ ok: false, errors: { price: expect.any(String) } });
    expect(validatePackageForm({ ...form, validDays: "3" })).toMatchObject({ ok: false, errors: { validDays: expect.any(String) } });
    expect(validatePackageForm({ ...form, eventTypeId: "nope" })).toMatchObject({ ok: false, errors: { eventTypeId: expect.any(String) } });
  });
});

describe.skipIf(!BASE)("session packages (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let coaching: EventType;
  let pkg: Package;
  let n = 0;
  const buyer = () => ({ name: "Kavya", email: `kavya${++n}@example.in`, phone: null, idempotencyKey: `pkg-key-${n}-${Math.random()}` });

  /** A purchase started and paid through Checkout, as the browser would report it. */
  async function bought(fake = fakeRazorpay()) {
    const r = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...buyer() });
    const pay: FakePayment = { id: `pay_${Math.random().toString(36).slice(2, 10)}`, order_id: r.payment!.orderId, amount: pkg.priceMinor, currency: "INR", status: "captured" };
    fake.state.payments.set(pay.id, pay);
    await confirmPurchase({ pool, auth, orders: fake.orders }, { token: r.token, paymentId: pay.id, signature: sign(pay.order_id, pay.id) }, new Date());
    return { token: r.token, fake, pay };
  }
  // Inside every package's validity, three hours apart so buffers never overlap.
  const nextStart = (() => { let s = 0; const base = Math.floor(Date.now() / DAY) * DAY + 20 * DAY + 19.5 * 3_600_000; /* 1am IST: clear of the demo bookings */ return () => new Date(base + s++ * 3 * 3_600_000); })();
  const bookWith = (token: string, startAt = nextStart(), weeks?: number) =>
    store.createBooking({ eventTypeId: coaching.id, startAt, idempotencyKey: `pkg-book-${Math.random()}`, packageToken: token, invitee: { name: "Kavya", email: "kavya@example.in", timezone: "Asia/Kolkata", phone: null, answers: [] }, ...(weeks ? { weeks } : {}) });

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_pkg`;
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
    coaching = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!;
    pkg = await createPackage(pool, priya.id, { eventTypeId: coaching.id, name: "3 coaching sessions", sessions: 3, priceMinor: 300_000, validDays: 60 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("only sells packages of the host's own bookable event types", async () => {
    const { rows: [other] } = await pool.query("select id from users where id <> $1 and deleted_at is null limit 1", [priya.id]);
    await expect(createPackage(pool, other.id, { eventTypeId: coaching.id, name: "x", sessions: 2, priceMinor: 100, validDays: 30 })).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("a paid purchase gives its buyer a link, emails both sides, and books up to its sessions", async () => {
    const { token } = await bought();
    const p = (await purchaseByToken(pool, token))!;
    expect(p).toMatchObject({ status: "paid", sessions: 3, used: 0 });
    expect(p.expiresAt!.getTime() - p.paidAt!.getTime()).toBe(60 * DAY);
    const { rows: mails } = await pool.query("select kind, recipient from notifications where dedupe_key like $1 order by kind", [`purchase:${p.id}:%`]);
    expect(mails).toEqual([{ kind: "package_guest", recipient: p.guestEmail }, { kind: "package_host", recipient: priya.email }]);
    const first = await bookWith(token);
    await bookWith(token);
    await bookWith(token);
    expect((await purchaseByToken(pool, token))!.used).toBe(3);
    await expect(bookWith(token)).rejects.toMatchObject({ name: "PackageUnavailableError", reason: "used_up" });
    // A cancelled session comes back.
    await store.cancelBooking(priya.id, first.id, "guest");
    expect((await purchaseByToken(pool, token))!.used).toBe(2);
    await bookWith(token);
  });

  it("emails the buyer their private link and the host the sale", async () => {
    const { token } = await bought();
    const sent: Mail[] = [];
    const mailer = { async send(m: Mail) { sent.push(m); return { id: `m${sent.length}` }; } };
    // Earlier tests left booking emails queued too: drain the queue.
    while ((await processDueNotifications(pool, mailer, { baseUrl: "https://hourhand.test" })).claimed > 0) { /* next batch */ }
    const p = (await purchaseByToken(pool, token))!;
    const { rows: states } = await pool.query("select kind, status, last_error from notifications where dedupe_key like $1", [`purchase:${p.id}:%`]);
    expect(states).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "package_guest", status: "sent" })]));
    const toBuyer = sent.find((m) => m.to === p.guestEmail)!;
    expect(toBuyer.subject).toBe(`Your 3 sessions with ${priya.name}`);
    expect(toBuyer.text).toContain(`https://hourhand.test/p/${token}`);
    const toHost = sent.find((m) => m.to === priya.email && m.subject.startsWith("Package sold"))!;
    expect(toHost.text).not.toContain(token); // the buyer's link is theirs alone
  });

  it("refuses unpaid, expired, wrong-event and unknown purchases", async () => {
    const fake = fakeRazorpay();
    const unpaid = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...buyer() });
    await expect(bookWith(unpaid.token)).rejects.toMatchObject({ reason: "unpaid" });
    const { token } = await bought();
    await expect(bookWith(token, new Date(Date.now() + 61 * DAY))).rejects.toMatchObject({ reason: "expired" });
    const intro = (await store.listEventTypes(priya.id)).find((e) => e.slug === "intro")!;
    await expect(store.createBooking({ eventTypeId: intro.id, startAt: nextStart(), idempotencyKey: `pkg-wrong-${Math.random()}`, packageToken: token, invitee: { name: "K", email: "k@example.in", timezone: "Asia/Kolkata", phone: null, answers: [] } }))
      .rejects.toMatchObject({ reason: "wrong_event" });
    await expect(bookWith("0".repeat(48))).rejects.toMatchObject({ reason: "not_found" });
    expect((await purchaseByToken(pool, token))!.used).toBe(0);
  });

  it("two bookings racing for the last session: exactly one gets it", async () => {
    const { token } = await bought();
    await bookWith(token);
    await bookWith(token);
    const results = await Promise.allSettled([bookWith(token), bookWith(token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await purchaseByToken(pool, token))!.used).toBe(3);
  });

  it("a repeated start reuses the purchase and its order", async () => {
    const fake = fakeRazorpay();
    const b = buyer();
    const one = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...b });
    const two = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...b });
    expect(two).toEqual(one);
    expect(fake.state.creates).toBe(1);
  });

  it("won't pay from a forged signature, another order's payment, or a smaller amount", async () => {
    const fake = fakeRazorpay();
    const r = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...buyer() });
    const deps = { pool, auth, orders: fake.orders };
    const pay = (o: Partial<FakePayment>) => {
      const p: FakePayment = { id: `pay_${Math.random().toString(36).slice(2, 10)}`, order_id: r.payment!.orderId, amount: pkg.priceMinor, currency: "INR", status: "captured", ...o };
      fake.state.payments.set(p.id, p);
      return p;
    };
    const good = pay({});
    await expect(confirmPurchase(deps, { token: r.token, paymentId: good.id, signature: "0".repeat(64) }, new Date())).rejects.toMatchObject({ reason: "bad_signature" });
    const cheap = pay({ amount: 100 });
    await expect(confirmPurchase(deps, { token: r.token, paymentId: cheap.id, signature: sign(cheap.order_id, cheap.id) }, new Date())).rejects.toBeInstanceOf(PurchaseVerifyError);
    const elsewhere = pay({ order_id: "order_someone_else" });
    await expect(confirmPurchase(deps, { token: r.token, paymentId: elsewhere.id, signature: sign(r.payment!.orderId, elsewhere.id) }, new Date())).rejects.toMatchObject({ reason: "mismatch" });
    expect((await purchaseByToken(pool, r.token))!.status).toBe("pending");
  });

  it("the reconciler pays a purchase whose buyer closed the tab, and gives up on one never paid after a day", async () => {
    const fake = fakeRazorpay();
    const paidLater = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...buyer() });
    fake.state.payments.set("pay_late", { id: "pay_late", order_id: paidLater.payment!.orderId, amount: pkg.priceMinor, currency: "INR", status: "authorized" });
    const never = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, ...buyer() });
    const deps = { pool, authFor: async () => auth, ordersFor: () => fake.orders };
    await reconcilePurchases(deps, new Date(Date.now() + 2 * 60_000));
    expect((await purchaseByToken(pool, paidLater.token))!.status).toBe("paid");
    expect(fake.state.payments.get("pay_late")!.status).toBe("captured");
    expect((await purchaseByToken(pool, never.token))!.status).toBe("pending");
    await reconcilePurchases(deps, new Date(Date.now() + DAY + 5 * 60_000));
    expect((await purchaseByToken(pool, never.token))!.status).toBe("failed");
    // Paying twice records once.
    const { rows: [p] } = await pool.query("select id from package_purchases where token = $1", [paidLater.token]);
    expect(await applyPurchasePayment(pool, p.id, "pay_late", new Date())).toBe("already");
  });

  describe("through the public handlers", () => {
    const deps = (fake: ReturnType<typeof fakeRazorpay>, plan: Plan = "solo"): PaymentDeps =>
      ({ pool, authFor: async () => auth, ordersFor: () => fake.orders, planFor: async () => plan });

    it("needs a paid plan, checks the buyer's details, and books a priced event type with no payment at booking", async () => {
      const fake = fakeRazorpay();
      expect(await handleStartPurchase(deps(fake, "free"), pkg.id, buyer())).toMatchObject({ status: 409, body: { error: "payments_unavailable" } });
      expect(await handleStartPurchase(deps(fake), pkg.id, { ...buyer(), email: "nope" })).toMatchObject({ status: 400, body: { fields: { email: expect.any(String) } } });
      const started = await handleStartPurchase(deps(fake), pkg.id, buyer());
      expect(started.status).toBe(200);
      const { token, payment } = started.body as { token: string; payment: { orderId: string } };
      fake.state.payments.set("pay_h", { id: "pay_h", order_id: payment.orderId, amount: pkg.priceMinor, currency: "INR", status: "captured" });
      expect(await handleConfirmPurchase(deps(fake), { token, paymentId: "pay_h", signature: sign(payment.orderId, "pay_h") }, new Date())).toEqual({ status: 200, body: { status: "paid" } });

      // Coaching is priced: with the package it books straight away, with no Razorpay order.
      await pool.query("update event_types set price_minor = 150000, currency = 'INR' where id = $1", [coaching.id]);
      try {
        const slots = (await import("../booking")).freeSlots;
        const [start] = await slots(store, priya, { ...coaching, priceMinor: 150_000, currency: "INR" }, new Date(), new Date(Date.now() + 30 * DAY), new Date());
        const creates = fake.state.creates;
        const res = await handleCreateBooking(store, {
          slug: "priya", event: "coaching", start: start.toISOString(), name: "Kavya", email: "kavya@example.in", timezone: "Asia/Kolkata",
          answers: Object.fromEntries((await store.listCustomQuestions(priya.id, coaching.id)).filter((q) => q.required).map((q) => [q.id, "Goal"])),
          idempotencyKey: `pkg-handler-${Math.random()}`, packageToken: token,
        }, new Date(), undefined, deps(fake));
        expect(res).toMatchObject({ status: 201 });
        expect((res.body as { payment?: unknown }).payment).toBeUndefined();
        expect(fake.state.creates).toBe(creates);
        const b = await store.getBooking(priya.id, (res.body as { bookingId: string }).bookingId);
        expect(b!.status).toBe("confirmed");
      } finally {
        await pool.query("update event_types set price_minor = null, currency = null where id = $1", [coaching.id]);
      }
    });
  });
});
