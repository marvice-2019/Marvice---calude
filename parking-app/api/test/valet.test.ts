import { beforeAll, describe, expect, it } from "vitest";
import { bookAndPay, idem, iso, seed, setup, type Ctx } from "./helpers.js";

let ctx: Ctx; let s: Awaited<ReturnType<typeof seed>>; let desk: string; let deskOther: string;
beforeAll(async () => {
  ctx = await setup(); s = await seed(ctx);
  const mk = async (op: string, lot: string | null, name: string) => (await ctx.db.query(
    `INSERT INTO valet_desks (operator_id, lot_id, name, geo, fee_paise, typical_eta_min, is_live)
     VALUES ($1,$2,$3,ST_MakePoint(77.5960,12.9716)::geography,15000,6,true) RETURNING id`, [op, lot, name])).rows[0].id as string;
  desk = await mk(s.op, s.lot, "UB City Mall entrance");
  deskOther = await mk(s.op2, null, "Other operator desk");
  await ctx.db.query(`INSERT INTO valet_validations (desk_id, validator, code, valid) VALUES ($1,'UB City restaurants','UBDINE',tstzrange(now() - interval '1 hour', now() + interval '1 day'))`, [desk]);
});
const photos = ["u/x/front.jpg", "u/x/rear.jpg", "u/x/left.jpg", "u/x/right.jpg"];
const drop = (payload: Record<string, unknown>, h = s.staff.h) =>
  ctx.app.inject({ method: "POST", url: "/v1/valet/tickets", headers: h, payload: { desk_id: desk, plate: "KA01AB1234", phone: "9500000001", key_tag: "K-23", photo_keys: photos, bay: "B2-14", ...payload } });
const driverFor = (phone: string) => ctx.login(phone);

describe("VAL-01 drop off", () => {
  it("staff create a parked ticket for a guest phone with 4 photos; WhatsApp notice sent", async () => {
    const r = await drop({ phone: "9500000001", key_tag: "K-10" });
    expect(r.statusCode).toBe(201);
    expect(r.json().ticket).toMatchObject({ status: "parked", key_tag: "K-10", bay: "B2-14", plate: "KA01AB1234", phone: "+919500000001" });
    expect(r.json().ticket.code).toMatch(/^VT-[0-9A-F]{4}$/);
    expect(ctx.notify.sent.some(n => n.event === "valet_ticket_created" && n.phone === "+919500000001")).toBe(true);
  });
  it("refuses a key tag already on an open ticket at the same desk", async () => {
    await drop({ phone: "9500000002", key_tag: "K-11" });
    const dup = await drop({ phone: "9500000003", key_tag: "k-11" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().message).toBe("Key tag K-11 is already in use. Pick another tag.");
  });
  it("needs exactly 4 photos, a valid plate, and staff of the desk's operator; retries dedupe", async () => {
    expect((await drop({ key_tag: "K-12", photo_keys: photos.slice(0, 3) })).json().message).toContain("Take all 4 handover photos");
    expect((await drop({ key_tag: "K-12", plate: "HELLO" })).json().message).toContain("Enter a valid number plate");
    expect((await drop({ key_tag: "K-12" }, s.otherStaff.h)).statusCode).toBe(403);
    const a = await drop({ key_tag: "K-13", client_id: "offline-valet-1" }), b = await drop({ key_tag: "K-13", client_id: "offline-valet-1" });
    expect([a.statusCode, b.statusCode, b.json().duplicate]).toEqual([201, 200, true]);
  });
  it("lists nearby live desks with fee, GST and today's validator", async () => {
    const r = (await ctx.app.inject({ method: "GET", url: "/v1/valet/desks?lat=12.9716&lng=77.5960" })).json();
    const d = r.find((x: any) => x.id === desk);
    expect(d).toMatchObject({ fee_paise: 15000, gst_paise: 2700, validator: "UB City restaurants", typical_eta_min: 6 });
  });
});

describe("VAL-02..05 request, validate, tip, status, collect", () => {
  it("paid request: ₹150 + ₹27 GST + ₹20 tip = ₹197; capture → requested; staff → coming → ready; collect closes", async () => {
    const t = (await drop({ phone: "9500000010", key_tag: "K-20" })).json().ticket;
    const d = await driverFor("9500000010");
    const r = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...idem() }, payload: { tip_paise: 2000 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().bill).toEqual({ fee_paise: 15000, gst_paise: 2700, tip_paise: 2000, total_paise: 19700 });
    await ctx.webhook("payment.captured", r.json().razorpay_order.id, 19700);
    let mine = (await ctx.app.inject({ method: "GET", url: "/v1/valet/tickets", headers: d.h })).json()[0];
    expect(mine.status).toBe("requested");
    expect(new Date(mine.eta_at).getTime() - new Date(mine.requested_at).getTime()).toBe(6 * 60_000);
    const inv = (await ctx.db.query("SELECT i.taxable_paise, i.cgst_paise + i.sgst_paise AS gst FROM invoices i JOIN payments p ON p.id = i.payment_id WHERE p.valet_ticket_id = $1", [t.id])).rows[0];
    expect(inv).toEqual({ taxable_paise: 15000, gst: 2700 }); // tip not invoiced
    const q = (await ctx.app.inject({ method: "GET", url: `/v1/ops/valet/queue?desk_id=${desk}`, headers: s.staff.h })).json();
    expect(q.map((x: any) => x.id)).toContain(t.id);
    const bad = await ctx.app.inject({ method: "PUT", url: `/v1/ops/valet/tickets/${t.id}/status`, headers: s.staff.h, payload: { status: "ready" } });
    expect(bad.statusCode).toBe(409); // must go through coming
    for (const st of ["coming", "ready"])
      expect((await ctx.app.inject({ method: "PUT", url: `/v1/ops/valet/tickets/${t.id}/status`, headers: s.staff.h, payload: { status: st } })).statusCode).toBe(200);
    expect(ctx.notify.sent.some(n => n.event === "valet_car_ready" && n.phone === "+919500000010")).toBe(true);
    const done = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/collected`, headers: d.h });
    expect(done.json().ticket.status).toBe("closed");
  });
  it("validated with no tip: no payment, straight to requested; wrong code explained", async () => {
    const t = (await drop({ phone: "9500000011", key_tag: "K-21" })).json().ticket;
    const d = await driverFor("9500000011");
    const wrong = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...idem() }, payload: { tip_paise: 0, validation_code: "NOPE" } });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().message).toBe("That code didn't work. Ask the counter for today's validation code.");
    const ok = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...idem() }, payload: { tip_paise: 0, validation_code: "ubdine" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ razorpay_order: null, ticket: { status: "requested", validated: true, fee_paise: 0 } });
  });
  it("validated with a tip charges only the tip and issues no GST invoice", async () => {
    const t = (await drop({ phone: "9500000012", key_tag: "K-22" })).json().ticket;
    const d = await driverFor("9500000012");
    const r = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...idem() }, payload: { tip_paise: 5000, validation_code: "UBDINE" } });
    expect(r.json().bill).toEqual({ fee_paise: 0, gst_paise: 0, tip_paise: 5000, total_paise: 5000 });
    await ctx.webhook("payment.captured", r.json().razorpay_order.id, 5000);
    expect((await ctx.db.query("SELECT tip_paise, status FROM valet_tickets WHERE id = $1", [t.id])).rows[0]).toEqual({ tip_paise: 5000, status: "requested" });
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM invoices i JOIN payments p ON p.id = i.payment_id WHERE p.valet_ticket_id = $1", [t.id])).rows[0].n).toBe(0);
  });
  it("only ₹0/20/50/100 tips; same Idempotency-Key gives the same order; can't request twice", async () => {
    const t = (await drop({ phone: "9500000013", key_tag: "K-24" })).json().ticket;
    const d = await driverFor("9500000013");
    expect((await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...idem() }, payload: { tip_paise: 3000 } })).statusCode).toBe(400);
    const key = idem();
    const a = (await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...key }, payload: { tip_paise: 0 } })).json();
    const b = (await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...key }, payload: { tip_paise: 0 } })).json();
    expect(b.razorpay_order.id).toBe(a.razorpay_order.id);
    await ctx.webhook("payment.captured", a.razorpay_order.id, a.bill.total_paise);
    const again = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...d.h, ...idem() }, payload: { tip_paise: 0 } });
    expect(again.json().message).toBe("This car has already been requested.");
  });
  it("another driver can't see or request my ticket", async () => {
    const t = (await drop({ phone: "9500000014", key_tag: "K-25" })).json().ticket;
    const other = await driverFor("9500000015");
    expect((await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/request`, headers: { ...other.h, ...idem() }, payload: { tip_paise: 0 } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/valet/tickets", headers: other.h })).json()).toEqual([]);
  });
});

describe("VAL-06 damage report", () => {
  it("needs a photo, works while ready, refuses after the 15-minute window", async () => {
    const t = (await drop({ phone: "9500000020", key_tag: "K-30" })).json().ticket;
    const d = await driverFor("9500000020");
    await ctx.db.query("UPDATE valet_tickets SET status = 'ready' WHERE id = $1", [t.id]);
    const noPhoto = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/damage`, headers: d.h, payload: { where: "rear" } });
    expect(noPhoto.json().message).toBe("Add a photo of the damage so we can compare it.");
    const ok = await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/damage`, headers: d.h, payload: { where: "rear", photo_key: "u/x/dent.jpg" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().reference).toBe(`${t.code}-D`);
    await ctx.db.query("UPDATE valet_tickets SET status = 'closed', closed_at = now() - interval '16 minutes' WHERE id = $1", [t.id]);
    expect((await ctx.app.inject({ method: "POST", url: `/v1/valet/tickets/${t.id}/damage`, headers: d.h, payload: { where: "rear", photo_key: "u/x/dent.jpg" } })).statusCode).toBe(410);
  });
});

describe("VAL-07 staff queue security and validations", () => {
  it("other operator's staff get 403 on queue and status; validation codes need the desk's operator admin", async () => {
    expect((await ctx.app.inject({ method: "GET", url: `/v1/ops/valet/queue?desk_id=${desk}`, headers: s.otherStaff.h })).statusCode).toBe(403);
    const t = (await drop({ phone: "9500000030", key_tag: "K-40", bay: undefined })).json().ticket;
    expect(t.status).toBe("dropped");
    expect((await ctx.app.inject({ method: "PUT", url: `/v1/ops/valet/tickets/${t.id}/status`, headers: s.otherStaff.h, payload: { status: "parked", bay: "B1" } })).statusCode).toBe(403);
    const noBay = await ctx.app.inject({ method: "PUT", url: `/v1/ops/valet/tickets/${t.id}/status`, headers: s.staff.h, payload: { status: "parked" } });
    expect(noBay.statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "PUT", url: `/v1/ops/valet/tickets/${t.id}/status`, headers: s.staff.h, payload: { status: "parked", bay: "B1-07" } })).json().ticket.bay).toBe("B1-07");
    const v = { desk_id: desk, validator: "Hospital help desk", code: "CARE", valid_from: iso(0), valid_to: iso(86_400_000) };
    expect((await ctx.app.inject({ method: "POST", url: "/v1/ops/valet/validations", headers: s.staff.h, payload: v })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/ops/valet/validations", headers: s.opAdmin.h, payload: v })).statusCode).toBe(201);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/ops/valet/validations", headers: s.opAdmin.h, payload: { ...v, desk_id: deskOther } })).statusCode).toBe(403);
  });
});

describe("DRV-14 mark my spot", () => {
  it("saves and replaces a spot on my booking; empty and foreign photos refused; bookings list shows it", async () => {
    const d = await ctx.login("9500000040");
    const b = await bookAndPay(ctx, d, s.lot2);
    const empty = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/spot`, headers: d.h, payload: { floor: " " } });
    expect(empty.json().message).toBe("Add a floor, bay, note or photo so you can find your car later.");
    expect((await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/spot`, headers: d.h, payload: { photo_key: "u/someone-else/x.jpg" } })).statusCode).toBe(400);
    await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/spot`, headers: d.h, payload: { floor: "B2", bay: "47" } });
    const up = await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/spot`, headers: d.h, payload: { floor: "B3", note: "Near lift B" } });
    expect(up.json().spot).toEqual({ floor: "B3", bay: null, note: "Near lift B", photo_url: null });
    const list = (await ctx.app.inject({ method: "GET", url: "/v1/bookings", headers: d.h })).json();
    expect(list[0].spot).toMatchObject({ floor: "B3", note: "Near lift B" });
    const other = await ctx.login("9500000041");
    expect((await ctx.app.inject({ method: "POST", url: `/v1/bookings/${b.booking.id}/spot`, headers: other.h, payload: { floor: "B1" } })).statusCode).toBe(404);
  });
  it("uploads accept images only and return a key under my folder", async () => {
    const d = await ctx.login("9500000042");
    expect((await ctx.app.inject({ method: "POST", url: "/v1/uploads", headers: d.h, payload: { content_type: "application/pdf" } })).json().message).toBe("Choose a photo (JPG or PNG).");
    const r = (await ctx.app.inject({ method: "POST", url: "/v1/uploads", headers: d.h, payload: { content_type: "image/jpeg" } })).json();
    expect(r.key).toMatch(new RegExp(`^u/${d.userId}/.+\\.jpeg$`));
  });
});

describe("DRV-15 destinations, DRV-16 filters, DRV-09 digits", () => {
  it("suggests venues by partial name, prefix matches first", async () => {
    const r = (await ctx.app.inject({ method: "GET", url: "/v1/destinations?q=ub" })).json();
    expect(r[0]).toMatchObject({ name: "UB City", kind: "mall" });
    expect((await ctx.app.inject({ method: "GET", url: "/v1/destinations?q=mall" })).json().length).toBeGreaterThanOrEqual(2);
  });
  it("filters lots: valet only shows lots with a live desk; saved needs sign-in and favourites", async () => {
    const url = (f: string) => `/v1/lots/search?lat=12.9757&lng=77.6066&from=${encodeURIComponent(iso(3_600_000))}&to=${encodeURIComponent(iso(7_200_000))}&filters=${f}`;
    const valet = (await ctx.app.inject({ method: "GET", url: url("valet") })).json();
    expect(valet.map((x: any) => x.lot.code)).toEqual(["BLR101"]);
    expect(valet[0].lot.valet).toBe(true);
    expect((await ctx.app.inject({ method: "GET", url: url("covered") })).json()).toEqual([]); // seed lots are not covered
    expect((await ctx.app.inject({ method: "GET", url: url("saved") })).statusCode).toBe(401);
    const d = await ctx.login("9500000050");
    await ctx.app.inject({ method: "PUT", url: `/v1/me/favourites/${s.lot2}`, headers: d.h });
    expect((await ctx.app.inject({ method: "GET", url: url("saved"), headers: d.h })).json().map((x: any) => x.lot.code)).toEqual(["BLR102"]);
    expect((await ctx.app.inject({ method: "GET", url: url("teleport") })).statusCode).toBe(400);
  });
  it("lot code lookup accepts digits only", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/lots/by-code/102" })).json().lot.code).toBe("BLR102");
  });
});

describe("ACC-01 preferences, ACC-02 data export", () => {
  it("saves alerts and language; rejects unknown languages", async () => {
    const d = await ctx.login("9500000060");
    const r = await ctx.app.inject({ method: "PUT", url: "/v1/me/preferences", headers: d.h, payload: { alerts: false, language: "kn" } });
    expect(r.json().preferences).toMatchObject({ alerts: false, language: "kn" });
    expect((await ctx.app.inject({ method: "PUT", url: "/v1/me/preferences", headers: d.h, payload: { language: "fr" } })).statusCode).toBe(400);
  });
  it("logs one export request per day", async () => {
    const d = await ctx.login("9500000061");
    expect((await ctx.app.inject({ method: "POST", url: "/v1/me/data-export", headers: d.h })).statusCode).toBe(202);
    const again = await ctx.app.inject({ method: "POST", url: "/v1/me/data-export", headers: d.h });
    expect(again.statusCode).toBe(429);
    expect(again.json().message).toContain("You already asked today");
  });
});
