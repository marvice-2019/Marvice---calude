// The monthly earnings report against real Postgres (only with TEST_DATABASE_URL; uses its own database <name>_earn).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { earningsCsv, monthOf, monthRange, monthlyEarnings, queueMonthlyReports } from "./earnings";
import { processDueNotifications } from "./jobs/worker";
import type { Mail } from "./mail/mailer";

const BASE = process.env.TEST_DATABASE_URL;

describe("months in India time", () => {
  it("bounds a month at IST midnight", () => {
    expect(monthRange("2026-10")).toEqual({ from: new Date("2026-09-30T18:30:00Z"), to: new Date("2026-10-31T18:30:00Z") });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthOf(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11");
  });
});

describe.skipIf(!BASE)("monthly earnings (Postgres)", () => {
  let pool: pg.Pool;
  let host: string;
  let other: string;
  const now = new Date("2026-11-05T06:00:00Z");
  const oct = (day: number, h = 6) => new Date(Date.UTC(2026, 9, day, h, 0));

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_earn`;
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
    pool = new pg.Pool({ connectionString: u.toString() });
    host = (await pool.query("insert into users (email, name, slug) values ('earn@example.com', 'Earn Host', 'earn') returning id")).rows[0].id;
    other = (await pool.query("insert into users (email, name, slug) values ('other@example.com', 'Other', 'other') returning id")).rows[0].id;
    const et = async (u: string, nm: string, slug: string) => (await pool.query("insert into event_types (user_id, name, slug, duration_minutes) values ($1, $2, $3, 60) returning id", [u, nm, slug])).rows[0].id;
    const coaching = await et(host, "Coaching", "coaching");
    const intro = await et(host, "Intro", "intro");
    const theirs = await et(other, "Theirs", "theirs");
    let k = 0;
    /** A booking at `start` with an optional payment. */
    const booking = async (u: string, e: string, start: Date, o: { status?: string; by?: string; noShow?: boolean; pay?: { amount: number; kind?: string; status: string; paidAt: Date; refunded?: number; updatedAt?: Date } } = {}) => {
      k += 1;
      const status = o.status ?? "confirmed";
      const end = new Date(start.getTime() + 3_600_000);
      const { rows: [b] } = await pool.query(
        `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, idempotency_key, cancelled_at, cancelled_by)
         values ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8) returning id`,
        [e, u, start, end, status, `earn-${k}`, status === "cancelled" ? start : null, status === "cancelled" ? (o.by ?? "guest") : null]);
      await pool.query("insert into invitees (booking_id, host_id, name, email, timezone, no_show_at) values ($1, $2, 'G', $3, 'Asia/Kolkata', $4)",
        [b.id, u, `g${k}@example.in`, o.noShow ? end : null]);
      if (o.pay) await pool.query(
        `insert into payments (booking_id, host_id, provider, amount_minor, currency, status, kind, paid_at, refunded_minor, updated_at, refunded_at, provider_order_id)
         values ($1, $2, 'razorpay', $3, 'INR', $4, $5, $6, $7, $8, $9, $10)`,
        [b.id, u, o.pay.amount, o.pay.status, o.pay.kind ?? "payment", o.pay.paidAt, o.pay.refunded ?? 0, o.pay.updatedAt ?? o.pay.paidAt,
         o.pay.status === "refunded" ? (o.pay.updatedAt ?? o.pay.paidAt) : null, `order_e${k}`]);
    };
    await booking(host, coaching, oct(3), { pay: { amount: 100_000, status: "paid", paidAt: oct(1) } });
    await booking(host, coaching, oct(10), { pay: { amount: 50_000, status: "refunded", paidAt: oct(2), refunded: 50_000, updatedAt: oct(4) } , status: "cancelled", by: "guest" });
    await booking(host, intro, oct(12), { noShow: true, pay: { amount: 20_000, kind: "deposit", status: "paid", paidAt: oct(5) } });
    await booking(host, intro, oct(14), { pay: { amount: 20_000, kind: "deposit", status: "paid", paidAt: oct(6) } });
    await booking(host, intro, oct(20), { pay: { amount: 20_000, kind: "deposit", status: "refunded", paidAt: oct(7), refunded: 20_000, updatedAt: oct(21) } });
    await booking(host, coaching, oct(25), { status: "cancelled", by: "host" });
    await booking(host, coaching, new Date("2026-09-30T19:00:00Z"), { pay: { amount: 70_000, status: "paid", paidAt: new Date("2026-09-30T19:00:00Z") } }); // 1 Oct 00:30 IST
    await booking(host, coaching, oct(31, 19), {}); // 1 Nov IST: not October
    await booking(other, theirs, oct(3), { pay: { amount: 999_900, status: "paid", paidAt: oct(1) } });
    const { rows: [pkg] } = await pool.query("insert into packages (user_id, event_type_id, name, sessions, price_minor, valid_days) values ($1, $2, '5 sessions', 5, 400000, 90) returning id", [host, coaching]);
    await pool.query(
      `insert into package_purchases (package_id, host_id, event_type_id, sessions, price_minor, valid_days, guest_name, guest_email, idempotency_key, status, paid_at, expires_at, provider_payment_id)
       values ($1, $2, $3, 5, 400000, 90, 'K', 'k@example.in', 'earn-pkg', 'paid', $4, $5, 'pay_earn_pkg')`, [pkg.id, host, coaching, oct(8), oct(8)]);
    const inv = (kind: string, number: string, tax: number, total: number) => pool.query(
      `insert into invoices (host_id, kind, number, fy, seq, issued_at, package_purchase_id, original_invoice_id, buyer_name, buyer_email, supplier, place_of_supply, description, sac, rate_bp,
         taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor)
       values ($1, $2, $3, '2627', 1, $4, (select id from package_purchases where idempotency_key = 'earn-pkg'), $5, 'K', 'k@example.in', '{}', '29', 'x', '999293', 1800, $6, $7, $7, 0, $8) returning id`,
      [host, kind, number, oct(8), null, total - 2 * tax, tax, total]);
    await inv("invoice", "E/2627/000001", 30_508, 400_000);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("adds up the month: prices, packages, refunds, deposits kept and held, GST, sessions, by event type", async () => {
    const e = (await monthlyEarnings(pool, host, "2026-10", now))!;
    expect(e).toMatchObject({
      bookingsMinor: 100_000 + 50_000 + 70_000, packagesMinor: 400_000, refundsMinor: 50_000, depositsKeptMinor: 20_000, depositsHeldMinor: 20_000,
      netMinor: 100_000 + 50_000 + 70_000 + 400_000 + 20_000 - 50_000, gstMinor: 61_016,
      sessions: { held: 4, noShows: 1, cancelledByGuest: 1, cancelledByHost: 1, upcoming: 0 },
    });
    expect(e.feeEstimateMinor).toBe(Math.round((640_000 * 200 * 1.18) / 10_000));
    expect(e.byEventType.map((l) => [l.eventName, l.bookingsMinor + l.packagesMinor])).toEqual([["Coaching", 620_000]]);
    expect(earningsCsv(e)).toContain("Net received,5900.00");
    expect(earningsCsv(e)).toContain("Refunds,-500.00"); // a number a spreadsheet adds up, not text
  });

  it("keeps a refund in the month it was made, whatever touches the row later", async () => {
    // A June refund; any later write (a reconcile, a replayed webhook) fires the updated_at trigger and moves updated_at to today.
    const { rows: [et] } = await pool.query("select id from event_types where user_id = $1 and slug = 'coaching'", [host]);
    const { rows: [b] } = await pool.query(
      `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, idempotency_key, cancelled_at, cancelled_by)
       values ($1, $2, '2026-06-10T06:00:00Z', '2026-06-10T07:00:00Z', '2026-06-10T06:00:00Z', '2026-06-10T07:00:00Z', 'cancelled', 'earn-june', '2026-06-09T06:00:00Z', 'guest') returning id`, [et.id, host]);
    await pool.query(
      `insert into payments (booking_id, host_id, provider, amount_minor, currency, status, kind, paid_at, refunded_minor, refunded_at, provider_order_id)
       values ($1, $2, 'razorpay', 30000, 'INR', 'refunded', 'payment', '2026-06-01T06:00:00Z', 30000, '2026-06-09T06:00:00Z', 'order_june')`, [b.id, host]);
    await pool.query("update payments set last_error = null where provider_order_id = 'order_june'");
    expect((await monthlyEarnings(pool, host, "2026-06", now))!.refundsMinor).toBe(30_000);
    expect((await monthlyEarnings(pool, host, monthOf(new Date()), now))!.refundsMinor).toBe(monthOf(new Date()) === "2026-10" ? 50_000 : 0);
  });

  it("emails each active host last month's figures once", async () => {
    expect(await queueMonthlyReports(pool, now)).toBe(2);
    expect(await queueMonthlyReports(pool, new Date(now.getTime() + 3_600_000))).toBe(0);
    const sent: Mail[] = [];
    await processDueNotifications(pool, { async send(m) { sent.push(m); return { id: `m${sent.length}` }; } }, { baseUrl: "https://hourhand.test", now });
    const mine = sent.find((m) => m.to === "earn@example.com")!;
    expect(mine.subject).toBe("Your October 2026 on Hourhand: ₹5,900");
    expect(mine.text).toContain("https://hourhand.test/dashboard/earnings?month=2026-10");
  });

  it("counts only the host's own money", async () => {
    expect((await monthlyEarnings(pool, other, "2026-10", now))!.bookingsMinor).toBe(999_900);
    expect((await monthlyEarnings(pool, host, "2026-09", now))!.bookingsMinor).toBe(0);
    expect(await monthlyEarnings(pool, host, "bad", now)).toBeNull();
  });
});
