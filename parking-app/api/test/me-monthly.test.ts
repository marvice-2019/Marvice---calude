import { beforeAll, describe, expect, it } from "vitest";
import { runMonthlyBilling } from "../src/routes/monthly.js";
import { bookAndPay, idem, seed, setup, type Ctx } from "./helpers.js";

let ctx: Ctx; let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => { ctx = await setup(); s = await seed(ctx); });

describe("DRV-07 saved profile", () => {
  it("prefills vehicle and payment method from the last booking", async () => {
    const d = await ctx.login("9300000001");
    const fresh = (await ctx.app.inject({ method: "GET", url: "/v1/me", headers: d.h })).json();
    expect(fresh.preferences).toEqual({ vehicle_id: null, payment_method: null });
    await bookAndPay(ctx, d, s.lot);
    const me = (await ctx.app.inject({ method: "GET", url: "/v1/me", headers: d.h })).json();
    expect(me.vehicles[0].plate).toBe("KA01AB1234");
    expect(me.preferences).toEqual({ vehicle_id: me.vehicles[0].id, payment_method: "upi" });
  });
  it("explicit preferences win, and only the user's own vehicles are allowed", async () => {
    const d = await ctx.login("9300000002"), other = await ctx.login("9300000003");
    const v = (await ctx.app.inject({ method: "POST", url: "/v1/me/vehicles", headers: d.h, payload: { plate: "ka 03 mm 7788", kind: "suv" } })).json().vehicle;
    expect(v.plate).toBe("KA03MM7788");
    const dup = await ctx.app.inject({ method: "POST", url: "/v1/me/vehicles", headers: d.h, payload: { plate: "KA03MM7788" } });
    expect(dup.statusCode).toBe(409);
    const ok = await ctx.app.inject({ method: "PUT", url: "/v1/me/preferences", headers: d.h, payload: { default_vehicle_id: v.id, payment_method: "card" } });
    expect(ok.json().preferences).toEqual({ default_vehicle_id: v.id, payment_method: "card" });
    const steal = await ctx.app.inject({ method: "PUT", url: "/v1/me/preferences", headers: other.h, payload: { default_vehicle_id: v.id } });
    expect(steal.statusCode).toBe(404);
    const bad = await ctx.app.inject({ method: "POST", url: "/v1/me/vehicles", headers: d.h, payload: { plate: "HELLO" } });
    expect(bad.json().message).toContain("Enter a valid number plate");
  });
});

describe("DRV-08 favourites", () => {
  it("saves and removes a lot", async () => {
    const d = await ctx.login("9300000004");
    expect((await ctx.app.inject({ method: "PUT", url: `/v1/me/favourites/${s.lot2}`, headers: d.h })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "PUT", url: `/v1/me/favourites/${s.lot2}`, headers: d.h })).statusCode).toBe(204); // idempotent
    expect((await ctx.app.inject({ method: "GET", url: "/v1/me", headers: d.h })).json().favourites).toEqual([s.lot2]);
    await ctx.app.inject({ method: "DELETE", url: `/v1/me/favourites/${s.lot2}`, headers: d.h });
    expect((await ctx.app.inject({ method: "GET", url: "/v1/me", headers: d.h })).json().favourites).toEqual([]);
  });
});

describe("DPDP erasure", () => {
  it("deleting the account revokes refresh tokens", async () => {
    const d = await ctx.login("9300000005");
    expect((await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: d.h })).statusCode).toBe(202);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh: d.refresh } })).statusCode).toBe(401);
  });
});

describe("MON-01..03 monthly passes", () => {
  it("request → approve with bay → pay → active; unpaid next month → reminders → paused → gate refuses", async () => {
    const d = await ctx.login("9300000006");
    const v = (await ctx.app.inject({ method: "POST", url: "/v1/me/vehicles", headers: d.h, payload: { plate: "KA51Z9999" } })).json().vehicle;
    const req = await ctx.app.inject({ method: "POST", url: "/v1/monthly-passes", headers: d.h, payload: { lot_id: s.lot, vehicle_id: v.id, starts_on: "2026-09-01" } });
    expect(req.statusCode).toBe(201);
    expect(req.json().message).toBe("Request sent. The operator replies within one working day.");
    const id = req.json().pass.id;

    const otherAdmin = await ctx.login("9300000099", "operator_admin");
    expect((await ctx.app.inject({ method: "POST", url: `/v1/ops/monthly-passes/${id}/approve`, headers: { ...otherAdmin.h, ...idem() }, payload: { bay_label: "B-12" } })).statusCode).toBe(403);

    const ap = await ctx.app.inject({ method: "POST", url: `/v1/ops/monthly-passes/${id}/approve`, headers: { ...s.opAdmin.h, ...idem() }, payload: { bay_label: "B-12" } });
    expect(ap.statusCode).toBe(200);
    expect(ap.json().razorpay_order.amount).toBe(420_000 + 75_600);
    expect(ap.json().payment_link).toMatch(/\/pay\/order_/);
    await ctx.webhook("payment.captured", ap.json().razorpay_order.id, 495_600);
    expect((await ctx.db.query("SELECT status FROM monthly_passes WHERE id = $1", [id])).rows[0].status).toBe("active");

    // October unpaid: reminders on the 3rd and 5th, paused on the 8th (IST)
    const oct3 = await runMonthlyBilling(ctx.deps, new Date("2026-10-03T09:00:00+05:30"));
    const oct5 = await runMonthlyBilling(ctx.deps, new Date("2026-10-05T09:00:00+05:30"));
    const oct6 = await runMonthlyBilling(ctx.deps, new Date("2026-10-06T09:00:00+05:30"));
    expect([oct3.reminded, oct5.reminded, oct6.reminded]).toEqual([1, 1, 0]);
    expect((await runMonthlyBilling(ctx.deps, new Date("2026-10-07T09:00:00+05:30"))).paused).toBe(0);
    expect((await runMonthlyBilling(ctx.deps, new Date("2026-10-08T09:00:00+05:30"))).paused).toBe(1);
    const gate = await ctx.app.inject({ method: "POST", url: "/v1/ops/gate-events", headers: s.staff.h,
      payload: { lot_id: s.lot, plate: "KA51Z9999", direction: "in", scanned_at: new Date().toISOString(), client_event_id: "mon-gate-1" } });
    expect(gate.statusCode).toBe(409);
    expect(gate.json().message).toBe("Monthly pass paused: payment due.");
  });
  it("the billing job needs the internal token", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/v1/internal/jobs/monthly-billing", payload: {} });
    expect(r.statusCode).toBe(401);
    const ok = await ctx.app.inject({ method: "POST", url: "/v1/internal/jobs/monthly-billing", headers: { "x-internal-token": "internal-token-123456" }, payload: { now: "2026-10-03T09:00:00+05:30" } });
    expect(ok.statusCode).toBe(200);
  });
  it("refuses lots without a monthly price", async () => {
    const d = await ctx.login("9300000007");
    await ctx.db.query("UPDATE lot_rates SET monthly_paise = NULL WHERE lot_id = $1", [s.lot2]);
    const v = (await ctx.app.inject({ method: "POST", url: "/v1/me/vehicles", headers: d.h, payload: { plate: "KA01C1111" } })).json().vehicle;
    const r = await ctx.app.inject({ method: "POST", url: "/v1/monthly-passes", headers: d.h, payload: { lot_id: s.lot2, vehicle_id: v.id, starts_on: "2026-11-01" } });
    expect(r.statusCode).toBe(409);
  });
});
