// GST invoices against real Postgres and a fake Razorpay (only with TEST_DATABASE_URL; uses its own database <name>_gst).
import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "../data/pg-store";
import type { DataStore, User } from "../data/types";
import { createPackage, confirmPurchase, startPurchase } from "../packages/packages";
import { confirmPayment, processRefunds, startPaidBooking } from "../payments/booking-payments";
import { keyPairAuth } from "../payments/host-razorpay";
import { razorpayOrders } from "../payments/razorpay-orders";
import { gstinCheckChar } from "./gst";
import { invoiceByToken, invoicesCsv, listInvoices, saveTaxProfile, validateTaxProfile, type Invoice } from "./invoices";
import { purgeClosedAccounts } from "../data/account-lifecycle";

const BASE = process.env.TEST_DATABASE_URL;
const auth = keyPairAuth("rzp_test_abcdefgh12", "k");
const sign = (order: string, payment: string) => createHmac("sha256", "k").update(`${order}|${payment}`).digest("hex");
const GSTIN = "29AAPFU0939F1Z" + gstinCheckChar("29AAPFU0939F1Z");

interface FakePayment { id: string; order_id: string; amount: number; currency: string; status: string }

function fakeRazorpay() {
  const payments = new Map<string, FakePayment>();
  const refunds = new Map<string, { id: string; status: string; amount: number }[]>();
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    if (method === "POST" && path === "/v1/orders") {
      const body = JSON.parse(String(init.body));
      return json({ id: `order_gst_${++n}_${Math.random().toString(36).slice(2, 8)}`, amount: body.amount, currency: body.currency, status: "created" });
    }
    const o = /^\/v1\/orders\/([^/]+)\/payments$/.exec(path);
    if (o) return json({ items: [...payments.values()].filter((p) => p.order_id === decodeURIComponent(o[1])) });
    const rf = /^\/v1\/payments\/([^/]+)\/(refund|refunds)$/.exec(path);
    if (rf) {
      const id = decodeURIComponent(rf[1]);
      if (rf[2] === "refunds") return json({ items: refunds.get(id) ?? [] });
      const r = { id: `rfnd_${++n}`, status: "processed", amount: payments.get(id)!.amount };
      refunds.set(id, [...(refunds.get(id) ?? []), r]);
      return json(r);
    }
    const m = /^\/v1\/payments\/([^/]+)(\/capture)?$/.exec(path);
    const p = m && payments.get(decodeURIComponent(m[1]));
    if (!p) return json({ error: { code: "BAD_REQUEST_ERROR", description: "no such payment" } }, 400);
    return json(p);
  }) as unknown as typeof fetch;
  return { payments, orders: razorpayOrders(auth, { baseUrl: "https://rp.fake", fetchImpl }) };
}

describe("GST details form", () => {
  const form = { legalName: "Priya Sharma Coaching LLP", address: "12 MG Road, Bengaluru 560001", gstin: GSTIN, sac: "999293", rate: "18", invoicePrefix: "prs" };
  it("takes a valid GSTIN and reads the state from it", () => {
    expect(validateTaxProfile(form)).toEqual({ ok: true, value: { legalName: form.legalName, address: form.address, stateCode: "29", gstin: GSTIN, sac: "999293", rateBp: 1800, invoicePrefix: "PRS" } });
  });
  it("refuses a prefix starting CN, which credit notes use", () => {
    expect(validateTaxProfile({ ...form, invoicePrefix: "CNAB" })).toMatchObject({ ok: false, errors: { invoicePrefix: expect.any(String) } });
  });

  it("refuses a bad GSTIN, SAC, rate or prefix", () => {
    const bad = validateTaxProfile({ ...form, gstin: GSTIN.slice(0, 14) + (GSTIN[14] === "A" ? "B" : "A"), sac: "12", rate: "10", invoicePrefix: "TOOLONG" });
    expect(bad).toMatchObject({ ok: false, errors: { gstin: expect.any(String), sac: expect.any(String), rate: expect.any(String), invoicePrefix: expect.any(String) } });
  });
});

describe("CSV export", () => {
  const doc = (o: Partial<Invoice>): Invoice => ({
    id: "i", hostId: "h", kind: "invoice", number: "PRS/2627/000001", token: "t", issuedAt: new Date("2027-03-31T19:00:00Z"), buyerName: "Asha", buyerEmail: "a@example.in",
    supplier: { legalName: "L", address: "A", gstin: "G", stateCode: "29" }, placeOfSupply: "29", description: "x", sac: "999293", rateBp: 1800,
    taxableMinor: 42_288, cgstMinor: 3806, sgstMinor: 3806, igstMinor: 0, totalMinor: 49_900, originalNumber: null, ...o,
  });
  it("defuses formulas typed by a guest, and dates documents in IST", () => {
    const csv = invoicesCsv([doc({ buyerName: '=HYPERLINK("http://x","Refund")', buyerEmail: "+cmd@example.in" })]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""Refund"")"`);
    expect(row).toContain(",'+cmd@example.in,");
    expect(row).toContain(",2027-04-01,"); // 00:30 IST on 1 April, though still 31 March in UTC
  });
});

describe.skipIf(!BASE)("GST invoices (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let arun: User;
  let coachingId: string;
  let slot = 0;
  const nextStart = () => new Date(Date.UTC(2034, 5, 5, 0, 0) + slot++ * 3 * 3_600_000);
  const guest = { name: "Asha Rao", email: "asha@example.in", timezone: "Asia/Kolkata", phone: null, answers: [] };

  /** A booking paid and confirmed through Checkout. */
  async function paidBooking(host: User, eventTypeId: string, fake = fakeRazorpay(), kind: "payment" | "deposit" = "payment", priceMinor = 49_900) {
    const r = await startPaidBooking({ pool, store, auth, orders: fake.orders }, { eventTypeId, startAt: nextStart(), idempotencyKey: `gst-${Math.random()}`, invitee: guest, priceMinor, kind }, new Date());
    const pay: FakePayment = { id: `pay_${Math.random().toString(36).slice(2, 10)}`, order_id: r.payment!.orderId, amount: priceMinor, currency: "INR", status: "captured" };
    fake.payments.set(pay.id, pay);
    await confirmPayment({ pool, auth, orders: fake.orders }, { bookingId: r.booking.id, paymentId: pay.id, signature: sign(pay.order_id, pay.id) }, new Date());
    const { rows: [p] } = await pool.query("select id from payments where booking_id = $1", [r.booking.id]);
    return { booking: r.booking, paymentId: p.id as string, fake };
  }
  const invoiceOf = async (paymentId: string) => (await pool.query("select * from invoices where payment_id = $1 order by kind", [paymentId])).rows;

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_gst`;
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
    arun = (await store.getUserBySlug("arun"))!;
    coachingId = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!.id;
    const v = validateTaxProfile({ legalName: "Priya Sharma Coaching LLP", address: "12 MG Road, Bengaluru 560001", gstin: GSTIN, sac: "999293", rate: "18", invoicePrefix: "PRS" });
    if (!v.ok) throw new Error("profile");
    await saveTaxProfile(pool, priya.id, v.value);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("a confirmed payment gets a numbered tax invoice splitting the GST-inclusive price, and the guest is emailed", async () => {
    const { paymentId } = await paidBooking(priya, coachingId);
    const [v] = await invoiceOf(paymentId);
    expect(v).toMatchObject({ kind: "invoice", place_of_supply: "29", sac: "999293", rate_bp: 1800, total_minor: 49_900, taxable_minor: 42_288, cgst_minor: 3806, sgst_minor: 3806, igst_minor: 0 });
    expect(v.number).toMatch(/^PRS\/\d{4}\/000001$/);
    expect(v.supplier).toEqual({ legalName: "Priya Sharma Coaching LLP", address: "12 MG Road, Bengaluru 560001", gstin: GSTIN, stateCode: "29" });
    expect((await pool.query("select recipient from notifications where dedupe_key = $1", [`invoice:${v.id}`])).rows).toEqual([{ recipient: guest.email }]);
    const viewed = await invoiceByToken(pool, v.token);
    expect(viewed!.number).toBe(v.number);
  });

  it("numbers run on without gaps, even when payments confirm at the same moment", async () => {
    const results = await Promise.all([1, 2, 3].map(() => paidBooking(priya, coachingId)));
    const numbers = (await Promise.all(results.map((r) => invoiceOf(r.paymentId)))).map(([v]) => Number(v.number.split("/")[2])).sort();
    expect(numbers).toEqual([2, 3, 4]);
  });

  it("a refund issues a credit note mirroring the invoice, in its own series", async () => {
    const { booking, paymentId, fake } = await paidBooking(priya, coachingId);
    await store.cancelBooking(priya.id, booking.id, "guest");
    await processRefunds({ pool, authFor: async () => auth, ordersFor: () => fake.orders }, new Date());
    const docs = await invoiceOf(paymentId);
    const v = docs.find((d) => d.kind === "invoice")!;
    const c = docs.find((d) => d.kind === "credit_note")!;
    expect(c).toMatchObject({ kind: "credit_note", original_invoice_id: v.id, total_minor: v.total_minor, cgst_minor: v.cgst_minor, sgst_minor: v.sgst_minor });
    expect(c.number).toMatch(/^CNPR\/\d{4}\/000001$/);
    // Running the refunds again changes nothing.
    await processRefunds({ pool, authFor: async () => auth, ordersFor: () => fake.orders }, new Date(Date.now() + 10 * 60_000));
    expect(await invoiceOf(paymentId)).toHaveLength(2);
  });

  it("no invoice for a deposit, or for a host without GST details", async () => {
    const deposit = await paidBooking(priya, coachingId, fakeRazorpay(), "deposit", 20_000);
    expect(await invoiceOf(deposit.paymentId)).toEqual([]);
    const arunEvent = (await store.listEventTypes(arun.id))[0].id;
    const unregistered = await paidBooking(arun, arunEvent);
    expect(await invoiceOf(unregistered.paymentId)).toEqual([]);
  });

  it("a paid session package gets an invoice too", async () => {
    const fake = fakeRazorpay();
    const pkg = await createPackage(pool, priya.id, { eventTypeId: coachingId, name: "5 sessions", sessions: 5, priceMinor: 200_000, validDays: 90 });
    const r = await startPurchase({ pool, auth, orders: fake.orders }, { packageId: pkg.id, name: "Kavya", email: "kavya@example.in", phone: null, idempotencyKey: `gst-pkg-${Math.random()}` });
    fake.payments.set("pay_pkg", { id: "pay_pkg", order_id: r.payment!.orderId, amount: 200_000, currency: "INR", status: "captured" });
    await confirmPurchase({ pool, auth, orders: fake.orders }, { token: r.token, paymentId: "pay_pkg", signature: sign(r.payment!.orderId, "pay_pkg") }, new Date());
    const { rows: [v] } = await pool.query("select v.* from invoices v join package_purchases p on p.id = v.package_purchase_id where p.token = $1", [r.token]);
    expect(v).toMatchObject({ kind: "invoice", total_minor: 200_000, description: "5 sessions: 5 × 45-min coaching session", buyer_email: "kavya@example.in" });
  });

  it("a closed account with invoices and credit notes is purged cleanly", async () => {
    const { rows: [host] } = await pool.query("insert into users (email, name, slug) values ('gst-purge@example.com', 'Purge Host', 'gst-purge') returning *");
    const { rows: [et] } = await pool.query("insert into event_types (user_id, name, slug, duration_minutes) values ($1, 'Call', 'call', 30) returning id", [host.id]);
    const v = validateTaxProfile({ legalName: "Purge Host", address: "1 Road, Pune 411001", gstin: "27AAPFU0939F1Z" + gstinCheckChar("27AAPFU0939F1Z"), sac: "999293", rate: "18", invoicePrefix: "PH" });
    if (!v.ok) throw new Error("profile");
    await saveTaxProfile(pool, host.id, v.value);
    const kept = await paidBooking({ ...priya, id: host.id } as User, et.id);
    const refunded = await paidBooking({ ...priya, id: host.id } as User, et.id);
    await store.cancelBooking(host.id, refunded.booking.id, "guest");
    await processRefunds({ pool, authFor: async () => auth, ordersFor: () => refunded.fake.orders }, new Date());
    expect((await pool.query("select kind from invoices where host_id = $1 order by kind", [host.id])).rows.map((r) => r.kind)).toEqual(["credit_note", "invoice", "invoice"]);
    expect(kept.paymentId).toBeTruthy();
    await pool.query("update users set deleted_at = now() - interval '31 days' where id = $1", [host.id]);
    const client = await pool.connect();
    try {
      await client.query("begin");
      expect(await purgeClosedAccounts(client, new Date())).toBeGreaterThanOrEqual(1);
      await client.query("commit");
    } finally {
      client.release();
    }
    expect((await pool.query("select count(*)::int as n from invoices where host_id = $1", [host.id])).rows[0].n).toBe(0);
  });

  it("exports the host's documents as CSV with credit notes negative", async () => {
    const csv = invoicesCsv(await listInvoices(pool, priya.id));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Type,Number,Date,Original invoice,Buyer,Buyer email,Place of supply,SAC,Rate %,Taxable value,CGST,SGST,IGST,Total");
    expect(lines.some((l) => l.startsWith("Credit note,CNPR/") && l.endsWith(",-499.00"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Invoice,PRS/") && l.includes(",29 Karnataka,999293,18.00,422.88,38.06,38.06,0.00,499.00"))).toBe(true);
  });
});
