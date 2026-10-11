import { beforeAll, describe, expect, it } from "vitest";
import { iso, seed, setup, type Ctx } from "./helpers.js";

let ctx: Ctx; let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => { ctx = await setup(); s = await seed(ctx); });

describe("DRV-03 sign in with OTP", () => {
  it("sends and verifies an OTP, then rotates the refresh token", async () => {
    const send = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone: "9876543210" } });
    expect(send.statusCode).toBe(200);
    const otp = ctx.otpBox.get("+919876543210")!;
    expect(otp).toMatch(/^\d{6}$/);
    const ok = await ctx.app.inject({ method: "POST", url: "/v1/auth/verify", payload: { phone: "9876543210", otp } });
    expect(ok.statusCode).toBe(200);
    const { refresh } = ok.json();
    const r1 = await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh } });
    expect(r1.statusCode).toBe(200);
    const reuse = await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh } });
    expect(reuse.statusCode).toBe(401); // rotated: old token is dead
  });
  it("rejects a wrong code with the spec message", async () => {
    await ctx.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone: "9876500000" } });
    const bad = await ctx.app.inject({ method: "POST", url: "/v1/auth/verify", payload: { phone: "9876500000", otp: "000000" === ctx.otpBox.get("+919876500000") ? "111111" : "000000" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().message).toBe("That code doesn't match. Check the SMS and try again.");
  });
  it("rejects bad phone numbers", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone: "5123456789" } });
    expect(r.statusCode).toBe(400);
  });
  it("limits OTPs to 5 per number per hour", async () => {
    for (let i = 0; i < 5; i++) expect((await ctx.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone: "9811111111" } })).statusCode).toBe(200);
    const r = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone: "9811111111" } });
    expect(r.statusCode).toBe(429);
    expect(r.json().message).toBe("Too many attempts. Try again in an hour.");
  });
  it("protected routes need a token", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/bookings" })).statusCode).toBe(401);
  });
});

describe("DRV-01 search", () => {
  const url = (extra = "") => `/v1/lots/search?lat=12.9757&lng=77.6066&from=${encodeURIComponent(iso(3_600_000))}&to=${encodeURIComponent(iso(4 * 3_600_000))}${extra}`;
  it("returns lots within 3 km nearest first, with code, quote and spots left", async () => {
    const r = await ctx.app.inject({ method: "GET", url: url() });
    expect(r.statusCode).toBe(200);
    const rows = r.json();
    expect(rows.map((x: any) => x.lot.code)).toEqual(["BLR101", "BLR103", "BLR102"]);
    expect(rows[0].quote.totalPaise).toBe(15_930);
    expect(rows[0].spots_left).toBe(20);
  });
  it("sorts by price and hides closed lots", async () => {
    await ctx.db.query("UPDATE lots SET status = 'closed' WHERE id = $1", [s.lot2]);
    const rows = (await ctx.app.inject({ method: "GET", url: url("&sort=price") })).json();
    expect(rows.find((x: any) => x.lot.code === "BLR102")).toBeUndefined();
    await ctx.db.query("UPDATE lots SET status = 'open' WHERE id = $1", [s.lot2]);
  });
  it("explains a leaving time before arrival", async () => {
    const r = await ctx.app.inject({ method: "GET", url: `/v1/lots/search?lat=12.97&lng=77.6&from=${encodeURIComponent(iso(7_200_000))}&to=${encodeURIComponent(iso(3_600_000))}` });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toContain("Leaving time must be after arrival");
  });
  it("caps bookings at 30 days", async () => {
    const r = await ctx.app.inject({ method: "GET", url: `/v1/lots/search?lat=12.97&lng=77.6&from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(31 * 86_400_000))}` });
    expect(r.json().message).toContain("Bookings run up to 30 days");
  });
});

describe("DRV-02 lot detail and DRV-06 promo quote", () => {
  it("shows the lot with a quote", async () => {
    const r = await ctx.app.inject({ method: "GET", url: `/v1/lots/${s.lot}?from=${encodeURIComponent(iso(3_600_000))}&to=${encodeURIComponent(iso(4 * 3_600_000))}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().quote.feePaise).toBe(1500);
  });
  it("applies FIRST50 and explains bad codes", async () => {
    const body = (promo: string, from = iso(3_600_000)) => ({ lot_id: s.lot, from, to: new Date(new Date(from).getTime() + 3 * 3_600_000).toISOString(), promo });
    const ok = (await ctx.app.inject({ method: "POST", url: "/v1/quotes", payload: body("first50") })).json();
    expect([ok.discountPaise, ok.totalPaise, ok.promo_error]).toEqual([6000, 8850, null]);
    const bad = (await ctx.app.inject({ method: "POST", url: "/v1/quotes", payload: body("NOPE") })).json();
    expect(bad.promo_error).toBe("NOPE isn't a valid code. Check the spelling, or try FIRST50.");
    const monday = "2026-10-12T10:00:00+05:30"; // a Monday
    const wk = (await ctx.app.inject({ method: "POST", url: "/v1/quotes", payload: body("WEEKEND20", monday) })).json();
    expect(wk.promo_error).toBe("WEEKEND20 works only when you arrive on a Saturday or Sunday.");
  });
});

describe("DRV-09 lot code lookup and OWN-01 lead", () => {
  it("finds a lot by code, ignoring spaces and case", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/v1/lots/by-code/blr-101" });
    expect(r.json().lot.code).toBe("BLR101");
  });
  it("explains an unknown code", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/v1/lots/by-code/BLR999" });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toContain("No lot with code BLR999");
  });
  it("saves an owner lead", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/v1/leads/owners", payload: { name: "Asha", phone: "9845012345", address: "Koramangala 5th Block", bays: 30 } });
    expect(r.statusCode).toBe(201);
    expect((await ctx.db.query("SELECT bays FROM owner_leads")).rows[0].bays).toBe(30);
  });
});
