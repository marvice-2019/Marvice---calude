import { beforeAll, describe, expect, it } from "vitest";
import { computePayouts } from "../src/routes/ops.js";
import { bookAndPay, idem, iso, seed, setup, type Ctx } from "./helpers.js";

let ctx: Ctx; let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => { ctx = await setup(); s = await seed(ctx); });
const gate = (h: Record<string, string>, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: "/v1/ops/gate-events", headers: h, payload: { scanned_at: new Date().toISOString(), client_event_id: "ev-" + Math.random().toString(36).slice(2, 12), ...payload } });

describe("OPS-01 check in, OPS-02 + DRV-13 check out with overstay", () => {
  it("checks in by pass code, dedupes offline retries, checks out with overstay billed", async () => {
    const d = await ctx.login("9400000001");
    const b = await bookAndPay(ctx, d, s.lot, 5, 2); // starts in 5 min, inside the 15-min early window
    const inn = await gate(s.staff.h, { lot_id: s.lot, pass_code: b.booking.code, direction: "in", client_event_id: "offline-123" });
    expect(inn.statusCode).toBe(200);
    expect((await gate(s.staff.h, { lot_id: s.lot, pass_code: b.booking.code, direction: "in", client_event_id: "offline-123" })).json().duplicate).toBe(true);
    // leave 90 minutes after the end → 2 started hours of overstay at ₹40 + GST
    const out = await gate(s.staff.h, { lot_id: s.lot, pass_code: b.booking.code, direction: "out", scanned_at: new Date(new Date(b.booking.to).getTime() + 90 * 60_000).toISOString() });
    expect(out.json().overstay).toMatchObject({ hours: 2, amount_paise: 8000 + 1440, message: "Overstay 2 h: collect ₹94.40." });
    expect((await ctx.db.query("SELECT status FROM bookings WHERE id = $1", [b.booking.id])).rows[0].status).toBe("completed");
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM gate_events WHERE booking_id = $1", [b.booking.id])).rows[0].n).toBe(2);
  });
  it("finds a pass by plate and refuses passes for another lot, early arrivals and unknown vehicles", async () => {
    const d = await ctx.login("9400000002");
    const b = await bookAndPay(ctx, d, s.lot2, 120, 2, { plate: "KA02XY4321" });
    const wrongLot = await gate(s.staff.h, { lot_id: s.lot, plate: "KA02XY4321", direction: "in" });
    expect(wrongLot.json().message).toBe("This pass is for a different lot.");
    const early = await gate(s.staff.h, { lot_id: s.lot2, pass_code: b.booking.code, direction: "in" });
    expect(early.json().error).toBe("too_early");
    const none = await gate(s.staff.h, { lot_id: s.lot, plate: "KA09ZZ0001", direction: "in" });
    expect(none.statusCode).toBe(404);
  });
  it("staff of another operator can't scan at this lot", async () => {
    const r = await gate(s.otherStaff.h, { lot_id: s.lot, plate: "KA01AB1234", direction: "in" });
    expect(r.statusCode).toBe(403);
  });
});

describe("OPS-03 rate cards", () => {
  it("a new card closes the open one; staff can't edit rates; true overlaps are rejected", async () => {
    const from = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const r = await ctx.app.inject({ method: "POST", url: `/v1/ops/lots/${s.lot}/rates`, headers: s.opAdmin.h, payload: { vehicle: "car", hourly_paise: 5000, valid_from: from } });
    expect(r.statusCode).toBe(201);
    const q = await ctx.app.inject({ method: "POST", url: "/v1/quotes", payload: { lot_id: s.lot, from: new Date(Date.now() + 3 * 86_400_000).toISOString(), to: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString() } });
    expect(q.json().ratePaise).toBe(5000);
    const staff = await ctx.app.inject({ method: "POST", url: `/v1/ops/lots/${s.lot}/rates`, headers: s.staff.h, payload: { vehicle: "car", hourly_paise: 1, valid_from: from } });
    expect(staff.statusCode).toBe(403);
    // a card starting before an existing future card would overlap it
    const overlap = await ctx.app.inject({ method: "POST", url: `/v1/ops/lots/${s.lot}/rates`, headers: s.opAdmin.h, payload: { vehicle: "car", hourly_paise: 4500, valid_from: new Date(Date.now() + 86_400_000).toISOString() } });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().message).toBe("A rate already covers these dates.");
  });
});

describe("OPS-04 lot status", () => {
  it("staff set the lot full; drivers with passes in the next 3 h are notified; audit logged", async () => {
    const d = await ctx.login("9400000003");
    await bookAndPay(ctx, d, s.lot2, 60, 1);
    const r = await ctx.app.inject({ method: "PUT", url: `/v1/ops/lots/${s.lot2}/status`, headers: s.staff.h, payload: { status: "gate_down" } });
    expect(r.json().notified).toBeGreaterThanOrEqual(1);
    expect(ctx.notify.sent.some(n => n.event === "lot_status" && n.phone === "+919400000003")).toBe(true);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'set_status'")).rows[0].n).toBe(1);
    await ctx.app.inject({ method: "PUT", url: `/v1/ops/lots/${s.lot2}/status`, headers: s.staff.h, payload: { status: "open" } });
  });
});

describe("OPS-05 dashboard and payouts", () => {
  it("computes weekly payouts (gross, 15% commission, 1% TDS) and serves CSV", async () => {
    const d = await ctx.login("9400000004");
    await bookAndPay(ctx, d, s.lot, 30, 3); // ₹120 parking
    const istToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const rows = await computePayouts(ctx.deps, istToday);
    const mine = rows.find(r => r.operator_id === s.op)!;
    expect(mine.commission_paise).toBe(Math.round(mine.gross_paise * 0.15));
    expect(mine.net_paise).toBe(mine.gross_paise - mine.commission_paise - mine.tds_paise);
    const csv = await ctx.app.inject({ method: "GET", url: "/v1/ops/payouts", headers: { ...s.opAdmin.h, accept: "text/csv" } });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toBe("period_start,period_end,gross_inr,commission_inr,tds_inr,net_inr,status");
    const dash = await ctx.app.inject({ method: "GET", url: `/v1/ops/dashboard?lot_id=${s.lot}&from=${encodeURIComponent(iso(-86_400_000))}&to=${encodeURIComponent(iso(86_400_000))}`, headers: s.opAdmin.h });
    expect(dash.json().bookings).toBeGreaterThanOrEqual(1);
    const otherOp = await ctx.app.inject({ method: "GET", url: `/v1/ops/dashboard?lot_id=${s.lotOther}&from=${encodeURIComponent(iso(-86_400_000))}&to=${encodeURIComponent(iso(86_400_000))}`, headers: s.opAdmin.h });
    expect(otherOp.statusCode).toBe(403);
  });
});

describe("ADM-01..03 platform admin", () => {
  it("onboards an operator and a lot with the next code; rejects a bad PAN", async () => {
    const bad = await ctx.app.inject({ method: "POST", url: "/v1/admin/operators", headers: s.platform.h, payload: { legal_name: "X", pan: "123" } });
    expect(bad.statusCode).toBe(400);
    const op = (await ctx.app.inject({ method: "POST", url: "/v1/admin/operators", headers: s.platform.h, payload: { legal_name: "New Lots Pvt Ltd", pan: "AAACN1234C", gstin: "29AAACN1234C1Z5" } })).json().operator;
    const lot = await ctx.app.inject({ method: "POST", url: "/v1/admin/lots", headers: s.platform.h, payload: {
      operator_id: op.id, name: "Indiranagar 100 Ft Road", address: "100 Feet Rd, Indiranagar", lat: 12.9784, lng: 77.6408, kind: "surface",
      capacity_car: 40, is_live: true, rates: [{ vehicle: "car", hourly_paise: 3500 }] } });
    expect(lot.statusCode).toBe(201);
    expect(lot.json().code).toMatch(/^BLR\d{3}$/);
    expect(lot.json().code).not.toBe("BLR101");
  });
  it("refunds part of a booking, never more than paid, and logs it", async () => {
    const d = await ctx.login("9400000005");
    const b = await bookAndPay(ctx, d, s.lot, 300, 3);
    const part = await ctx.app.inject({ method: "POST", url: "/v1/admin/refunds", headers: { ...s.platform.h, ...idem() }, payload: { booking_id: b.booking.id, amount_paise: 5000, reason: "gate down" } });
    expect(part.statusCode).toBe(200);
    const over = await ctx.app.inject({ method: "POST", url: "/v1/admin/refunds", headers: { ...s.platform.h, ...idem() }, payload: { booking_id: b.booking.id, amount_paise: 20_000 } });
    expect(over.statusCode).toBe(409);
    expect((await ctx.db.query("SELECT status, refunded_paise FROM payments WHERE booking_id = $1", [b.booking.id])).rows[0]).toEqual({ status: "partially_refunded", refunded_paise: 5000 });
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'refund'")).rows[0].n).toBe(1);
  });
  it("creates promos and rejects duplicates; operators can't", async () => {
    const p = { code: "DIWALI25", percent_off: 25, max_off_paise: 15000 };
    expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/promos", headers: s.platform.h, payload: p })).statusCode).toBe(201);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/promos", headers: s.platform.h, payload: p })).statusCode).toBe(409);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/promos", headers: s.opAdmin.h, payload: p })).statusCode).toBe(403);
  });
});
