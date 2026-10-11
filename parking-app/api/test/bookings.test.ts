import { beforeAll, describe, expect, it } from "vitest";
import { bookAndPay, idem, iso, seed, setup, type Ctx } from "./helpers.js";

let ctx: Ctx; let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => { ctx = await setup(); s = await seed(ctx); });

const book = (h: Record<string, string>, payload: Record<string, unknown>, key = idem()) =>
  ctx.app.inject({ method: "POST", url: "/v1/bookings", headers: { ...h, ...key }, payload: { plate: "KA05MN4821", ...payload } });

describe("DRV-04 pre-book and pay", () => {
  it("holds, creates an order, confirms on captured webhook, issues pass, invoice and notice", async () => {
    const d = await ctx.login("9100000001");
    const r = await book(d.h, { lot_id: s.lot, from: iso(3_600_000), to: iso(4 * 3_600_000) });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.booking.status).toBe("pending_payment");
    expect(b.booking.code).toMatch(/^BL-[0-9A-F]{5}$/);
    expect(b.razorpay_order.amount).toBe(15_930);
    const w = await ctx.webhook("payment.captured", b.razorpay_order.id, 15_930);
    expect(w.json().result).toBe("captured");
    expect((await ctx.db.query("SELECT status FROM bookings WHERE id = $1", [b.booking.id])).rows[0].status).toBe("confirmed");
    const inv = (await ctx.db.query("SELECT number, taxable_paise, cgst_paise, sgst_paise FROM invoices")).rows[0];
    expect(inv.number).toMatch(/^BL\/\d{4}-\d{2}\/000001$/);
    expect(inv.taxable_paise + inv.cgst_paise + inv.sgst_paise).toBe(15_930);
    expect(ctx.notify.sent.some(n => n.event === "pass_issued" && n.phone === "+919100000001")).toBe(true);
  });
  it("cancels the hold when payment fails", async () => {
    const d = await ctx.login("9100000002");
    const b = (await book(d.h, { lot_id: s.lot, from: iso(3_600_000), to: iso(2 * 3_600_000) })).json();
    await ctx.webhook("payment.failed", b.razorpay_order.id, b.razorpay_order.amount);
    expect((await ctx.db.query("SELECT status FROM bookings WHERE id = $1", [b.booking.id])).rows[0].status).toBe("cancelled");
  });
  it("rejects arrival in the past", async () => {
    const d = await ctx.login("9100000003");
    const r = await book(d.h, { lot_id: s.lot, from: iso(-3_600_000), to: iso(3_600_000) });
    expect(r.statusCode).toBe(400);
  });
  it("requires an Idempotency-Key and replays the same response for the same key", async () => {
    const d = await ctx.login("9100000004");
    const no = await ctx.app.inject({ method: "POST", url: "/v1/bookings", headers: d.h, payload: { lot_id: s.lot, from: iso(3_600_000), to: iso(7_200_000), plate: "KA01AB1234" } });
    expect(no.statusCode).toBe(400);
    const key = idem(), p = { lot_id: s.lot, from: iso(3_600_000), to: iso(7_200_000) };
    const a = (await book(d.h, p, key)).json(), b = (await book(d.h, p, key)).json();
    expect(b.razorpay_order.id).toBe(a.razorpay_order.id);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone = '+919100000004'")).rows[0].n).toBe(1);
  });
});

describe("Webhook security and replay", () => {
  it("rejects a bad signature", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/v1/webhooks/razorpay", payload: "{}", headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef", "x-razorpay-event-id": "e1" } });
    expect(r.statusCode).toBe(400);
  });
  it("processes the same event id once (one payment, one invoice)", async () => {
    const d = await ctx.login("9100000005");
    const b = (await book(d.h, { lot_id: s.lot2, from: iso(3_600_000), to: iso(2 * 3_600_000) })).json();
    const before = (await ctx.db.query("SELECT count(*)::int AS n FROM invoices")).rows[0].n;
    const first = await ctx.webhook("payment.captured", b.razorpay_order.id, b.razorpay_order.amount, "evt_replay_1", "pay_replay_1");
    const again = await ctx.webhook("payment.captured", b.razorpay_order.id, b.razorpay_order.amount, "evt_replay_1", "pay_replay_1");
    const otherId = await ctx.webhook("payment.captured", b.razorpay_order.id, b.razorpay_order.amount, "evt_replay_2", "pay_replay_1");
    expect([first.json().result, again.json().result, otherId.json().result]).toEqual(["captured", "duplicate", "already_captured"]);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM invoices")).rows[0].n).toBe(before + 1);
  });
  it("rejects a captured amount that doesn't match the order", async () => {
    const d = await ctx.login("9100000006");
    const b = (await book(d.h, { lot_id: s.lot2, from: iso(3_600_000), to: iso(2 * 3_600_000) })).json();
    const w = await ctx.webhook("payment.captured", b.razorpay_order.id, 1);
    expect(w.statusCode).toBe(400);
    expect((await ctx.db.query("SELECT status FROM bookings WHERE id = $1", [b.booking.id])).rows[0].status).toBe("pending_payment");
  });
});

describe("DRV-05 lot full and the race test", () => {
  it("N concurrent holds on a 1-bay lot produce exactly 1 booking; losers get alternatives", async () => {
    const lot = (await ctx.db.query(
      `INSERT INTO lots (operator_id, name, address, city, geo, kind, capacity_car, online_share, is_live, code)
       VALUES ($1,'One Bay','x','Bengaluru',ST_MakePoint(77.6067,12.9758)::geography,'surface',1,1,true,'BLR150') RETURNING id`, [s.op])).rows[0].id;
    await ctx.db.query("INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, valid) VALUES ($1,'car',4000,tstzrange('-infinity',NULL))", [lot]);
    const drivers = await Promise.all(Array.from({ length: 8 }, (_, i) => ctx.login(`92000000${10 + i}`)));
    const from = iso(3_600_000), to = iso(3 * 3_600_000);
    const res = await Promise.all(drivers.map(d => book(d.h, { lot_id: lot, from, to })));
    const codes = res.map(r => r.statusCode).sort();
    expect(codes.filter(c => c === 201)).toHaveLength(1);
    expect(codes.filter(c => c === 409)).toHaveLength(7);
    const loser = res.find(r => r.statusCode === 409)!.json();
    expect(loser.message).toBe("This lot just filled up. Try a nearby lot.");
    expect(loser.alternatives.length).toBeGreaterThan(0);
  });
});

describe("DRV-06 promo at booking", () => {
  it("FIRST50 discounts the first booking, counts use on capture, and is refused the second time", async () => {
    const d = await ctx.login("9100000007");
    const b = await bookAndPay(ctx, d, s.lot, 60, 3, { promo: "FIRST50" });
    expect([b.quote.discountPaise, b.razorpay_order.amount]).toEqual([6000, 8850]);
    expect((await ctx.db.query("SELECT used_count FROM promo_codes WHERE code = 'FIRST50'")).rows[0].used_count).toBe(1);
    const again = await book(d.h, { lot_id: s.lot, from: iso(10 * 3_600_000), to: iso(11 * 3_600_000), promo: "FIRST50" });
    expect(again.statusCode).toBe(422);
    expect(again.json().message).toBe("FIRST50 works on your first booking only.");
  });
});

describe("DRV-09 Park now", () => {
  it("starts now for the chosen hours", async () => {
    const d = await ctx.login("9100000008");
    const r = await book(d.h, { lot_id: s.lot, source: "park_now", hours: 2 });
    expect(r.statusCode).toBe(201);
    const b = r.json().booking;
    expect(Math.abs(new Date(b.from).getTime() - Date.now())).toBeLessThan(120_000);
    expect(new Date(b.to).getTime() - new Date(b.from).getTime()).toBe(2 * 3_600_000);
    expect(b.source).toBe("park_now");
  });
});

describe("DRV-10, GST-01, GST-02 passes belong to the phone number", () => {
  it("a guest's passes show again after signing in later", async () => {
    const g = await ctx.login("9100000009");
    const b = await bookAndPay(ctx, g, s.lot);
    const later = await ctx.login("9100000009");
    const list = (await ctx.app.inject({ method: "GET", url: "/v1/bookings", headers: later.h })).json();
    expect(list.map((x: any) => x.code)).toContain(b.booking.code);
    expect(list[0]).toMatchObject({ lot_code: "BLR101", plate: "KA01AB1234", phone: "+919100000009" }); // bookAndPay's default plate
  });
});

describe("DRV-11 extend", () => {
  it("charges 1 h + GST and moves the end time on capture", async () => {
    const d = await ctx.login("9100000010");
    const b = await bookAndPay(ctx, d, s.lot);
    const r = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/extend`, headers: { ...d.h, ...idem() } });
    expect(r.statusCode).toBe(201);
    expect(r.json().amount_paise).toBe(4000 + 720);
    await ctx.webhook("payment.captured", r.json().razorpay_order.id, 4720);
    const end = (await ctx.db.query("SELECT upper(period) AS e FROM bookings WHERE id = $1", [b.booking.id])).rows[0].e;
    expect(end.getTime()).toBe(new Date(b.booking.to).getTime() + 3_600_000);
  });
  it("refuses when the lot is full for the extra hour", async () => {
    const lot = (await ctx.db.query(
      `INSERT INTO lots (operator_id, name, address, city, geo, kind, capacity_car, online_share, is_live, code)
       VALUES ($1,'Tight','x','Bengaluru',ST_MakePoint(77.61,12.97)::geography,'surface',1,1,true,'BLR151') RETURNING id`, [s.op])).rows[0].id;
    await ctx.db.query("INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, valid) VALUES ($1,'car',4000,tstzrange('-infinity',NULL))", [lot]);
    const a = await ctx.login("9100000011"), b2 = await ctx.login("9100000012");
    const first = await bookAndPay(ctx, a, lot, 60, 2);
    await bookAndPay(ctx, b2, lot, 180, 2); // starts exactly when the first ends
    const r = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${first.booking.id}/extend`, headers: { ...a.h, ...idem() } });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toMatch(/^Can't extend: the lot is full after/);
  });
});

describe("DRV-12 cancel", () => {
  it("refunds in full before arrival", async () => {
    const d = await ctx.login("9100000013");
    const b = await bookAndPay(ctx, d, s.lot2, 120);
    const r = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/cancel`, headers: { ...d.h, ...idem() } });
    expect(r.statusCode).toBe(200);
    expect(r.json().refund.amount_paise).toBe(15_930);
    expect(r.json().refund.message).toBe("Cancelled. Full refund in 3–5 working days.");
    expect(ctx.payments.refunds.at(-1)!.amountPaise).toBe(15_930);
  });
  it("refuses Park now passes", async () => {
    const d = await ctx.login("9100000014");
    const r = await book(d.h, { lot_id: s.lot2, source: "park_now", hours: 1 });
    await ctx.webhook("payment.captured", r.json().razorpay_order.id, r.json().razorpay_order.amount);
    const c = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${r.json().booking.id}/cancel`, headers: { ...d.h, ...idem() } });
    expect(c.statusCode).toBe(409);
  });
});

describe("Security: drivers only touch their own bookings", () => {
  it("another driver can't extend or cancel my booking", async () => {
    const me = await ctx.login("9100000015"), other = await ctx.login("9100000016");
    const b = await bookAndPay(ctx, me, s.lot2, 240);
    for (const action of ["extend", "cancel"]) {
      const r = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/${action}`, headers: { ...other.h, ...idem() } });
      expect(r.statusCode).toBe(404);
    }
    const list = (await ctx.app.inject({ method: "GET", url: "/v1/bookings", headers: other.h })).json();
    expect(list.find((x: any) => x.id === b.booking.id)).toBeUndefined();
  });
  it("drivers can't call operator or admin routes", async () => {
    const d = await ctx.login("9100000017");
    expect((await ctx.app.inject({ method: "PUT", url: `/v1/ops/lots/${s.lot}/status`, headers: d.h, payload: { status: "full" } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/promos", headers: d.h, payload: {} })).statusCode).toBe(403);
  });
});

describe("Late capture after a failed attempt or an expired hold (no overbooking)", () => {
  // Razorpay lets a driver retry in the same checkout after a failed attempt, and a capture can
  // arrive after the 10-minute hold. The bay may have gone to someone else by then.
  let n = 0;
  const oneBay = async () => {
    const lot = (await ctx.db.query(
      `INSERT INTO lots (operator_id, name, address, city, geo, kind, capacity_car, online_share, is_live, code)
       VALUES ($1,'One Bay Late','x','Bengaluru',ST_MakePoint(77.6068,12.9759)::geography,'surface',1,1,true,$2) RETURNING id`, [s.op, `BLR16${n++}`])).rows[0].id as string;
    await ctx.db.query("INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, valid) VALUES ($1,'car',4000,tstzrange('-infinity',NULL))", [lot]);
    return lot;
  };
  const status = async (id: string) => (await ctx.db.query("SELECT status FROM bookings WHERE id = $1", [id])).rows[0].status;
  const confirmedOn = async (lot: string) => (await ctx.db.query("SELECT count(*)::int AS n FROM bookings WHERE lot_id = $1 AND status = 'confirmed'", [lot])).rows[0].n;

  it("confirms a retry captured after a failed attempt when the bay is still free", async () => {
    const lot = await oneBay(), d = await ctx.login("9300000001");
    const b = (await book(d.h, { lot_id: lot, from: iso(3_600_000), to: iso(2 * 3_600_000) })).json();
    await ctx.webhook("payment.failed", b.razorpay_order.id, b.razorpay_order.amount);
    expect(await status(b.booking.id)).toBe("cancelled");
    const w = await ctx.webhook("payment.captured", b.razorpay_order.id, b.razorpay_order.amount);
    expect(w.json().result).toBe("captured");
    expect(await status(b.booking.id)).toBe("confirmed");
  });

  it("refunds a capture after a failed attempt when the bay went to another driver", async () => {
    const lot = await oneBay(), a = await ctx.login("9300000002"), other = await ctx.login("9300000003");
    const from = iso(3_600_000), to = iso(2 * 3_600_000);
    const b = (await book(a.h, { lot_id: lot, from, to })).json();
    await ctx.webhook("payment.failed", b.razorpay_order.id, b.razorpay_order.amount);
    const taken = (await book(other.h, { lot_id: lot, from, to })).json();
    await ctx.webhook("payment.captured", taken.razorpay_order.id, taken.razorpay_order.amount);
    const refundsBefore = ctx.payments.refunds.length;
    const w = await ctx.webhook("payment.captured", b.razorpay_order.id, b.razorpay_order.amount);
    expect(w.statusCode).toBe(200);
    expect(w.json().result).toBe("refunded_lot_full");
    expect(await status(b.booking.id)).toBe("cancelled");
    expect(await confirmedOn(lot)).toBe(1);
    expect(ctx.payments.refunds.length).toBe(refundsBefore + 1);
    expect(ctx.payments.refunds.at(-1)!.amountPaise).toBe(b.razorpay_order.amount);
    const p = (await ctx.db.query("SELECT status, refunded_paise FROM payments WHERE razorpay_order_id = $1", [b.razorpay_order.id])).rows[0];
    expect(p).toMatchObject({ status: "refunded", refunded_paise: b.razorpay_order.amount });
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM invoices i JOIN payments p ON p.id = i.payment_id WHERE p.razorpay_order_id = $1", [b.razorpay_order.id])).rows[0].n).toBe(0);
    expect(ctx.notify.sent.some(x => x.event === "refund_issued" && x.phone === "+919300000002")).toBe(true);
  });

  it("refunds a capture that lands after the hold expired and the bay was resold", async () => {
    const lot = await oneBay(), a = await ctx.login("9300000004"), other = await ctx.login("9300000005");
    const from = iso(3_600_000), to = iso(2 * 3_600_000);
    const b = (await book(a.h, { lot_id: lot, from, to })).json();
    await ctx.db.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [b.booking.id]);
    const taken = (await book(other.h, { lot_id: lot, from, to })).json();
    await ctx.webhook("payment.captured", taken.razorpay_order.id, taken.razorpay_order.amount);
    const w = await ctx.webhook("payment.captured", b.razorpay_order.id, b.razorpay_order.amount);
    expect(w.json().result).toBe("refunded_lot_full");
    expect(await confirmedOn(lot)).toBe(1);
  });

  it("replaying an Idempotency-Key whose booking was released starts a fresh booking", async () => {
    const lot = await oneBay(), d = await ctx.login("9300000006");
    const key = idem(), p = { lot_id: lot, from: iso(3_600_000), to: iso(2 * 3_600_000) };
    const first = (await book(d.h, p, key)).json();
    await ctx.webhook("payment.failed", first.razorpay_order.id, first.razorpay_order.amount);
    const again = await book(d.h, p, key);
    expect(again.statusCode).toBe(201);
    expect(again.json().booking.id).not.toBe(first.booking.id);
    expect(again.json().razorpay_order.id).not.toBe(first.razorpay_order.id);
    expect(again.json().booking.status).toBe("pending_payment");
  });
});
