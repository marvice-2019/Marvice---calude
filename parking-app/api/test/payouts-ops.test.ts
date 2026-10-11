import { beforeAll, describe, expect, it } from "vitest";
import { payoutSplit } from "../src/routes/ops.js";
import { bookAndPay, idem, seed, setup, type Ctx } from "./helpers.js";

// One fresh database for this file, so the week's payout can be hand-checked to the paise.
let ctx: Ctx; let s: Awaited<ReturnType<typeof seed>>;
let lifecycle: { bookingId: string; code: string };
/** Monday of the current IST week (payout weeks run Monday to Sunday). */
const istWeekStart = () => { const d = new Date(Date.now() + 330 * 60_000); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const gate = (h: Record<string, string>, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: "/v1/ops/gate-events", headers: h, payload: { client_event_id: "ev-" + Math.random().toString(36).slice(2, 12), ...payload } });

beforeAll(async () => {
  ctx = await setup(); s = await seed(ctx);
  await ctx.db.query("UPDATE operators SET gstin = '29ABCDE1234F1Z5' WHERE id = $1", [s.op]); // GST-registered: TCS applies
});

describe("OPS-01/02 + DRV-13: a pass's whole life at the gate", () => {
  it("expected today → check in → parked → late check out bills overstay → paid → can't re-enter", async () => {
    const d = await ctx.login("9500000001");
    const b = await bookAndPay(ctx, d, s.lot, 30, 3); // ₹40/h × 3 h = ₹120 parking
    lifecycle = { bookingId: b.booking.id, code: b.booking.code };
    const from = new Date(b.booking.from), to = new Date(b.booking.to);

    const expected = await ctx.app.inject({ method: "GET", url: `/v1/ops/lots/${s.lot}/arrivals`, headers: s.staff.h });
    expect(expected.statusCode).toBe(200);
    expect(expected.json().some((a: { code: string; status: string }) => a.code === b.booking.code && a.status === "confirmed")).toBe(true);

    const inn = await gate(s.staff.h, { lot_id: s.lot, pass_code: b.booking.code, direction: "in", scanned_at: from.toISOString() });
    expect(inn.statusCode).toBe(200);
    const lots = (await ctx.app.inject({ method: "GET", url: "/v1/ops/lots", headers: s.staff.h })).json();
    expect(lots.find((l: { id: string }) => l.id === s.lot).parked_now).toBe(1);

    // 70 minutes late = 2 started hours of overstay at ₹40 + 18% GST = ₹94.40
    const out = await gate(s.staff.h, { lot_id: s.lot, plate: "KA01AB1234", direction: "out", scanned_at: new Date(to.getTime() + 70 * 60_000).toISOString() });
    expect(out.statusCode).toBe(200);
    expect(out.json().overstay).toMatchObject({ hours: 2, amount_paise: 9440 });
    const orderId = out.json().overstay.payment_link.split("/pay/")[1];
    expect((await ctx.webhook("payment.captured", orderId, 9440)).statusCode).toBe(200);

    const status = (await ctx.db.query("SELECT status FROM bookings WHERE id = $1", [b.booking.id])).rows[0].status;
    expect(status).toBe("completed");
    const again = await gate(s.staff.h, { lot_id: s.lot, pass_code: b.booking.code, direction: "in", scanned_at: new Date().toISOString() });
    expect(again.statusCode).toBe(404);
  });
});

describe("consoles: every role can read its own profile", () => {
  it("GET /v1/me works for staff, operator admin and platform admin, with their role", async () => {
    for (const [who, role] of [[s.staff, "operator_staff"], [s.opAdmin, "operator_admin"], [s.platform, "platform_admin"]] as const) {
      const r = await ctx.app.inject({ method: "GET", url: "/v1/me", headers: who.h });
      expect(r.statusCode).toBe(200);
      expect(r.json().user.role).toBe(role);
    }
  });
});

describe("OPS roles: operators see only their own lots; staff can't edit rates or see money", () => {
  it("scopes lots, rates, arrivals and dashboard by operator and role", async () => {
    const mine = (await ctx.app.inject({ method: "GET", url: "/v1/ops/lots", headers: s.opAdmin.h })).json().map((l: { id: string }) => l.id);
    expect(mine.sort()).toEqual([s.lot, s.lot2].sort());
    expect(mine).not.toContain(s.lotOther);

    expect((await ctx.app.inject({ method: "GET", url: `/v1/ops/lots/${s.lot}/rates`, headers: s.staff.h })).statusCode).toBe(200);
    const edit = await ctx.app.inject({ method: "POST", url: `/v1/ops/lots/${s.lot}/rates`, headers: s.staff.h,
      payload: { vehicle: "car", hourly_paise: 9900, valid_from: new Date(Date.now() + 86_400_000).toISOString() } });
    expect(edit.statusCode).toBe(403);
    const dash = await ctx.app.inject({ method: "GET", url: `/v1/ops/dashboard?lot_id=${s.lot}&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z`, headers: s.staff.h });
    expect(dash.statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: `/v1/ops/lots/${s.lot}/arrivals`, headers: s.otherStaff.h })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: `/v1/ops/lots/${s.lotOther}/rates`, headers: s.opAdmin.h })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/admin/payouts", headers: s.opAdmin.h })).statusCode).toBe(403);
  });

  it("dashboard gives hourly buckets and the same money split as the payout", async () => {
    const from = new Date(Date.now() - 6 * 3_600_000), to = new Date(Date.now() + 18 * 3_600_000);
    const r = await ctx.app.inject({ method: "GET", url: `/v1/ops/dashboard?lot_id=${s.lot}&from=${from.toISOString()}&to=${to.toISOString()}`, headers: s.opAdmin.h });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.by_hour.length).toBeGreaterThanOrEqual(24);
    expect(new Date(d.by_hour[0].hour).getTime()).toBe(from.getTime()); // buckets start at "from" (IST days start at :30 UTC)
    expect(d.by_hour.some((h: { arrivals: number }) => h.arrivals >= 1)).toBe(true);
    // booking ₹120 + overstay ₹80 captured for this lot
    expect(d.revenue).toMatchObject({ gross_paise: 20000, commission_paise: 3000, commission_gst_paise: 540, tds_paise: 20, tcs_paise: 100, net_paise: 16340 });
    const tooLong = await ctx.app.inject({ method: "GET", url: `/v1/ops/dashboard?lot_id=${s.lot}&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z`, headers: s.opAdmin.h });
    expect(tooLong.statusCode).toBe(400);
  });
});

describe("OPS-05 payouts: one week checked by hand", () => {
  it("matches the hand calculation, excludes cancelled and other operators, and is idempotent", async () => {
    // A cancelled booking on our other lot (₹80) and a booking at another operator's lot (₹80).
    const d2 = await ctx.login("9500000002");
    const cancelled = await bookAndPay(ctx, d2, s.lot2, 240, 2);
    const c = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${cancelled.booking.id}/cancel`, headers: { ...d2.h, ...idem() } });
    expect(c.statusCode).toBe(200);
    await bookAndPay(ctx, d2, s.lotOther, 30, 2);

    const sunday = await ctx.app.inject({ method: "POST", url: "/v1/admin/payouts/run", headers: s.platform.h, payload: { week_start: "2026-10-11" } });
    expect(sunday.statusCode).toBe(400);
    const run = await ctx.app.inject({ method: "POST", url: "/v1/admin/payouts/run", headers: s.platform.h, payload: { week_start: istWeekStart() } });
    expect(run.statusCode).toBe(200);
    const created = run.json().created as { operator_id: string }[];

    /* Hand check, operator 1 (GST-registered, 15% commission):
         gross      = 12000 (3 h booking) + 8000 (2 h overstay)  = 20000 paise   (cancelled ₹80 excluded)
         commission = 15% of 20000                               =  3000
         GST on it  = 18% of 3000                                =   540
         TDS 194-O  = 0.1% of 20000                              =    20
         TCS s.52   = 0.5% of 20000                              =   100
         net        = 20000 − 3000 − 540 − 20 − 100              = 16340  (₹163.40)
       Operator 2 (no GSTIN, so no TCS): gross 8000, commission 1200, GST 216, TDS 8, TCS 0, net 6576. */
    expect(created.find(p => p.operator_id === s.op)).toMatchObject({ gross_paise: 20000, commission_paise: 3000, commission_gst_paise: 540, tds_paise: 20, tcs_paise: 100, net_paise: 16340, payments_count: 2 });
    expect(created.find(p => p.operator_id === s.op2)).toMatchObject({ gross_paise: 8000, commission_paise: 1200, commission_gst_paise: 216, tds_paise: 8, tcs_paise: 0, net_paise: 6576 });
    expect(payoutSplit(20000, 1500, true, ctx.deps.cfg)).toEqual({ gross_paise: 20000, commission_paise: 3000, commission_gst_paise: 540, tds_paise: 20, tcs_paise: 100, net_paise: 16340 });

    const again = await ctx.app.inject({ method: "POST", url: "/v1/admin/payouts/run", headers: s.platform.h, payload: { week_start: istWeekStart() } });
    expect(again.json().created).toHaveLength(0);

    const csv = await ctx.app.inject({ method: "GET", url: "/v1/ops/payouts", headers: { ...s.opAdmin.h, accept: "text/csv" } });
    expect(csv.body.split("\n")[1]).toContain(",2,200.00,30.00,5.40,0.20,1.00,163.40,pending,");
  });

  it("sends a payout through Route once, and the transfer webhook marks it paid", async () => {
    const list = (await ctx.app.inject({ method: "GET", url: "/v1/admin/payouts?status=pending", headers: s.platform.h })).json();
    const p = list.find((x: { operator: string }) => x.operator === "Test Parking Pvt Ltd");
    const noAcc = await ctx.app.inject({ method: "POST", url: `/v1/admin/payouts/${p.id}/transfer`, headers: s.platform.h });
    expect(noAcc.json().error).toBe("no_account");

    const bad = await ctx.app.inject({ method: "PUT", url: `/v1/admin/operators/${s.op}/payout-account`, headers: s.platform.h, payload: { route_account_id: "12345" } });
    expect(bad.statusCode).toBe(400);
    const acc = await ctx.app.inject({ method: "PUT", url: `/v1/admin/operators/${s.op}/payout-account`, headers: s.platform.h, payload: { route_account_id: "acc_ABCDEFGHIJ1234" } });
    expect(acc.statusCode).toBe(200);

    const t = await ctx.app.inject({ method: "POST", url: `/v1/admin/payouts/${p.id}/transfer`, headers: s.platform.h });
    expect(t.json().payout).toMatchObject({ status: "processing", amount_paise: 16340 });
    expect(ctx.payments.transfers).toEqual([expect.objectContaining({ account: "acc_ABCDEFGHIJ1234", amountPaise: 16340 })]);
    const twice = await ctx.app.inject({ method: "POST", url: `/v1/admin/payouts/${p.id}/transfer`, headers: s.platform.h });
    expect(twice.json().error).toBe("not_payable");
    expect(ctx.payments.transfers).toHaveLength(1);

    const body = { event: "transfer.processed", payload: { transfer: { entity: { id: t.json().payout.razorpay_transfer_id } } } };
    expect((await ctx.rawWebhook(body, "evt_trf_1")).json().result).toBe("payout_paid");
    expect((await ctx.rawWebhook(body, "evt_trf_1")).json().result).toBe("duplicate");
    const paid = (await ctx.app.inject({ method: "GET", url: "/v1/ops/payouts", headers: s.opAdmin.h })).json()[0];
    expect(paid).toMatchObject({ status: "paid", net_paise: 16340 });
    expect(paid.transferred_at).toBeTruthy();
  });

  it("every admin money action is in the audit log", async () => {
    const r = (await ctx.app.inject({ method: "GET", url: "/v1/admin/audit?limit=20", headers: s.platform.h })).json();
    const actions = r.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["run_payouts", "set_payout_account", "transfer"]));
    expect(r.entries.find((e: { action: string }) => e.action === "transfer").after).toMatchObject({ amount_paise: 16340 });
    const lookup = await ctx.app.inject({ method: "GET", url: `/v1/admin/bookings/${lifecycle.code}`, headers: s.platform.h });
    expect(lookup.json().refundable_paise).toBe(15930 + 9440); // 3 h booking (₹120 + ₹15 fee) × 1.18 = ₹159.30, + overstay ₹94.40
  });
});
