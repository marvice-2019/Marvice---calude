import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toIndianE164 } from "../src/booking/phone";
import {
  adminListBookings,
  adminTransition,
  BOOKING_RATE_LIMIT,
  cancelByGuest,
  createBooking,
  createHold,
  deleteHold,
  getAvailability,
  getSlots,
  lookupBooking,
} from "../src/booking/service";
import { bookableDates, serviceDateOf, slotStartUtc, slotsFor, type WeekHours } from "../src/booking/time";
import { auditLog, bookings, settings, tables, users } from "../src/db/schema";
import { deliverBookingEvent, signPayload } from "../src/lib/notify";
import { getSettings, type Settings } from "../src/lib/settings";
import { freshDb } from "./db-helpers";

const day = { open: "11:30", close: "01:00" };
const HOURS: WeekHours = { mon: null, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
const NOW = new Date("2026-12-01T06:30:00Z"); // Tue 1 Dec 2026, 12:00 IST

let conn: Awaited<ReturnType<typeof freshDb>>;
let s: Settings;
let staffId: string;
let ipN = 0;
const ip = () => `198.51.100.${++ipN}`;

const form = (over: Record<string, unknown> = {}) => ({
  table: "T4",
  date: "2026-12-04",
  time: "21:00",
  guests: 4,
  name: "Asha Rao",
  phone: "98765 43210",
  notes: "Birthday",
  consent: true,
  website: "",
  ...over,
});
const create = (over: Record<string, unknown> = {}, at = NOW, from = ip()) =>
  createBooking(conn.db, s, form(over), { ip: from, now: at });

beforeAll(async () => {
  conn = await freshDb();
  await conn.db.update(settings).set({ value: HOURS }).where(eq(settings.key, "hours"));
  s = await getSettings(conn.db);
  const [u] = await conn.db
    .insert(users)
    .values({ email: "mgr@hydra.test", name: "Mgr", passwordHash: "x", role: "manager" })
    .returning();
  staffId = u!.id;
});
afterAll(async () => conn?.sql.end());
beforeEach(async () => {
  await conn.db.execute(sql`truncate bookings, table_holds, rate_limit_hits, audit_log`);
  await conn.db.update(tables).set({ seats: null, active: true });
});

describe("time rules (Asia/Kolkata, service day cutoff 05:00)", () => {
  it("a 00:30 slot on the 1st is 2 Dec 00:30 IST and belongs to the 1st's night", () => {
    const start = slotStartUtc("2026-12-01", "00:30");
    expect(start.toISOString()).toBe("2026-12-01T19:00:00.000Z");
    expect(serviceDateOf(start)).toBe("2026-12-01");
    expect(serviceDateOf(new Date("2026-12-01T23:29:00Z"))).toBe("2026-12-01"); // 04:59 IST
    expect(serviceDateOf(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-02"); // 05:00 IST
  });

  it("11:30 → 01:00 gives 26 half-hourly starts, the last at midnight, none running past close", () => {
    const slots = slotsFor(HOURS, "2026-12-01", 120);
    expect(slots).toHaveLength(26);
    expect(slots[0]!.time).toBe("11:30");
    expect(slots.at(-1)!.time).toBe("00:00");
    const close = slotStartUtc("2026-12-01", "01:00").getTime();
    expect(slots.every((x) => x.endsAt.getTime() <= close)).toBe(true);
    expect(slots.find((x) => x.time === "23:30")!.endsAt.toISOString()).toBe(new Date(close).toISOString());
  });

  it("a closed day and unset hours give no slots", () => {
    expect(slotsFor(HOURS, "2026-12-07", 120)).toEqual([]); // Monday
    expect(slotsFor(null, "2026-12-01", 120)).toEqual([]);
  });

  it("at 00:30 IST the booking window still starts with last night's service date", () => {
    const after_midnight = new Date("2026-12-01T19:00:00Z");
    expect(bookableDates(after_midnight, 3)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
  });
});

describe("phone", () => {
  it("normalises common Indian formats to E.164 and rejects the rest", () => {
    for (const v of ["9876543210", "98765 43210", "+91 98765-43210", "919876543210", "09876543210"]) {
      expect(toIndianE164(v)).toBe("+919876543210");
    }
    for (const v of ["5876543210", "987654321", "+1 415 555 0100", "abcdefghij"]) expect(toIndianE164(v)).toBeNull();
  });
});

describe("availability", () => {
  it("is closed while hours are unconfirmed", async () => {
    const closed = { ...s, hours: null };
    expect(await getSlots(conn.db, closed, "2026-12-04", NOW)).toMatchObject({ ok: false, status: 503, code: "booking_closed" });
  });

  it("lists today's remaining slots with free-table counts", async () => {
    const r = await getSlots(conn.db, s, "2026-12-01", NOW);
    if (!r.ok) throw new Error(r.message);
    expect(r.slots[0]).toEqual({ time: "12:30", available: 20 }); // 11:30 and 12:00 already passed
  });

  it("marks booked, overlapping and held tables", async () => {
    expect((await create({ table: "T4", time: "21:00" })).ok).toBe(true);
    await createHold(conn.db, staffId, { zone: "vip", date: "2026-12-04", reason: "Private party" });
    const at22 = await getAvailability(conn.db, s, "2026-12-04", "22:00", NOW);
    if (!at22.ok) throw new Error(at22.message);
    const state = Object.fromEntries(at22.tables.map((t) => [t.code, t.state]));
    expect(state["T4"]).toBe("booked"); // 21:00-23:00 overlaps 22:00
    expect(state["VIP-1"]).toBe("held");
    expect(state["VIP-2"]).toBe("held");
    expect(state["T5"]).toBe("available");
    const at23 = await getAvailability(conn.db, s, "2026-12-04", "23:00", NOW);
    expect(at23.ok && at23.tables.find((t) => t.code === "T4")!.state).toBe("available"); // back-to-back is fine
  });

  it("rejects dates outside the window, passed slots, non-slots and closed days", async () => {
    expect(await getAvailability(conn.db, s, "2026-12-30", "21:00", NOW)).toMatchObject({ code: "date_out_of_window" });
    expect(await getAvailability(conn.db, s, "2026-12-01", "11:30", NOW)).toMatchObject({ code: "slot_passed" });
    expect(await getAvailability(conn.db, s, "2026-12-04", "21:15", NOW)).toMatchObject({ code: "bad_time" });
    expect(await getAvailability(conn.db, s, "2026-12-07", "21:00", NOW)).toMatchObject({ code: "bad_time" });
  });
});

describe("create booking", () => {
  it("stores a pending booking with E.164 phone, consent time and UTM, and returns an event for n8n", async () => {
    const r = await create({ utm: { utm_source: "instagram", utm_campaign: "nye" } });
    if (!r.ok) throw new Error(r.message);
    expect(r.booking).toMatchObject({ status: "pending", table: "T4", zone: "standard", date: "2026-12-04", time: "21:00", guests: 4 });
    expect(r.booking.ref).toMatch(/^HYD-[A-HJ-NP-Z2-9]{4}$/);
    const [row] = await conn.db.select().from(bookings).where(eq(bookings.ref, r.booking.ref));
    expect(row).toMatchObject({ phoneE164: "+919876543210", source: "web", utm: { utm_source: "instagram", utm_campaign: "nye" } });
    expect(row!.contactConsentAt).toEqual(NOW);
    expect(r.event).toMatchObject({ type: "booking.created", payload: { ref: r.booking.ref, phone_e164: "+919876543210", time: "21:00" } });
  });

  it("an after-midnight slot is stored on the right night", async () => {
    const r = await create({ time: "00:00" }); // last slot, an hour before the 01:00 close
    if (!r.ok) throw new Error(r.message);
    expect(r.booking.date).toBe("2026-12-04");
    expect(r.booking.startsAt).toBe("2026-12-04T18:30:00.000Z"); // 5 Dec 00:00 IST
    expect(r.booking.endsAt).toBe("2026-12-04T19:30:00.000Z"); // capped at 01:00 close
    const [row] = await conn.db.select().from(bookings).where(eq(bookings.ref, r.booking.ref));
    expect(row!.serviceDate).toBe("2026-12-04"); // DB generated column agrees with the app
  });

  it("the second booking of the same table and time gets 'just taken' with alternatives from the same zone", async () => {
    expect((await create()).ok).toBe(true);
    const second = await create({ time: "22:00" });
    expect(second).toMatchObject({ ok: false, status: 409, code: "table_taken", message: "That table was just taken. Try another one." });
    const alts = (second as unknown as { alternatives: { code: string; zone: string }[] }).alternatives;
    expect(alts).toHaveLength(5);
    expect(alts.every((a) => a.zone === "standard" && a.code !== "T4")).toBe(true);
  });

  it("two simultaneous requests for one table and slot: exactly one succeeds", async () => {
    const results = await Promise.all([create({}, NOW, ip()), create({}, NOW, ip()), create({}, NOW, ip())]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "table_taken")).toBe(true);
  });

  it("refuses held tables", async () => {
    await createHold(conn.db, staffId, { table: "T4", date: "2026-12-04", reason: "Band setup" });
    expect(await create()).toMatchObject({ status: 409, code: "table_taken", message: "T4 is reserved that night. Try another table." });
  });

  it("validates guests against settings and table seats, phone and consent", async () => {
    expect(await create({ guests: 13 })).toMatchObject({ code: "invalid", fields: { guests: "T4 takes up to 12 guests." } });
    await conn.db.update(tables).set({ seats: 4 }).where(eq(tables.code, "T4"));
    expect(await create({ guests: 5 })).toMatchObject({ fields: { guests: "T4 takes up to 4 guests." } });
    expect(await create({ phone: "12345" })).toMatchObject({ fields: { phone: "Enter a 10-digit Indian mobile number." } });
    expect(await create({ consent: false })).toMatchObject({ code: "invalid", fields: { consent: expect.any(String) } });
    expect(await create({ name: "  " })).toMatchObject({ fields: { name: "Tell us your name." } });
    expect(await create({ table: "T99" })).toMatchObject({ code: "bad_table" });
    expect(await conn.db.select().from(bookings)).toHaveLength(0);
  });

  it("a filled honeypot looks like success but stores nothing and notifies no one", async () => {
    const r = await create({ website: "http://spam.example" });
    expect(r.ok && r.event).toBe(null);
    expect(r.ok && r.booking.ref).toMatch(/^HYD-/);
    expect(await conn.db.select().from(bookings)).toHaveLength(0);
  });

  it(`allows ${BOOKING_RATE_LIMIT.limit} attempts per IP per hour, counting failed ones`, async () => {
    const same = "203.0.113.50";
    for (let i = 0; i < BOOKING_RATE_LIMIT.limit; i++) await create({ phone: "bad" }, NOW, same);
    expect(await create({}, NOW, same)).toMatchObject({ status: 429, code: "rate_limited" });
    expect((await create({}, NOW, "203.0.113.51")).ok).toBe(true);
  });

  it("is closed when booking is switched off", async () => {
    const r = await createBooking(conn.db, { ...s, booking_enabled: false }, form(), { ip: ip(), now: NOW });
    expect(r).toMatchObject({ status: 503, code: "booking_closed" });
  });

  it("with captcha switched on, needs a passing check", async () => {
    const on = { ...s, captcha_enabled: true };
    expect(await createBooking(conn.db, on, form(), { ip: ip(), now: NOW })).toMatchObject({ code: "captcha_failed" });
    const pass = await createBooking(conn.db, on, form({ captchaToken: "ok" }), {
      ip: ip(),
      now: NOW,
      verifyCaptcha: async (t) => t === "ok",
    });
    expect(pass.ok).toBe(true);
  });
});

describe("guest lookup and cancel", () => {
  it("needs the right last 4 digits, and an unknown ref looks the same", async () => {
    const r = await create();
    if (!r.ok) throw new Error(r.message);
    expect(await lookupBooking(conn.db, { ref: r.booking.ref, last4: "3210" })).toMatchObject({ ok: true, booking: { ref: r.booking.ref } });
    const wrong = await lookupBooking(conn.db, { ref: r.booking.ref, last4: "0000" });
    const unknown = await lookupBooking(conn.db, { ref: "HYD-ZZZZ", last4: "3210" });
    expect(wrong).toEqual(unknown);
    expect(wrong).toMatchObject({ status: 404 });
  });

  it("cancels once, frees the table, audits it and emits an event", async () => {
    const r = await create();
    if (!r.ok) throw new Error(r.message);
    const c = await cancelByGuest(conn.db, { ref: r.booking.ref, last4: "3210" }, NOW);
    expect(c).toMatchObject({ ok: true, booking: { status: "cancelled" }, event: { type: "booking.cancelled", payload: { cancelled_by: "guest" } } });
    expect(await cancelByGuest(conn.db, { ref: r.booking.ref, last4: "3210" }, NOW)).toMatchObject({ status: 409 });
    expect((await create()).ok).toBe(true);
    const audit = await conn.db.select().from(auditLog).where(eq(auditLog.action, "booking.cancelled_by_guest"));
    expect(audit).toHaveLength(1);
  });

  it("won't cancel a booking that has started", async () => {
    const r = await create();
    if (!r.ok) throw new Error(r.message);
    const during = new Date(new Date(r.booking.startsAt).getTime() + 60_000);
    expect(await cancelByGuest(conn.db, { ref: r.booking.ref, last4: "3210" }, during)).toMatchObject({ code: "not_cancellable" });
  });
});

describe("admin bookings and holds", () => {
  it("lists a night's bookings with filters", async () => {
    await create({ table: "T1" });
    await create({ table: "VIP-1" });
    const all = await adminListBookings(conn.db, { date: "2026-12-04" }, NOW);
    expect(all.ok && all.bookings.map((b) => b.table)).toEqual(["T1", "VIP-1"]);
    const vip = await adminListBookings(conn.db, { date: "2026-12-04", zone: "vip" }, NOW);
    expect(vip.ok && vip.bookings.map((b) => b.table)).toEqual(["VIP-1"]);
    expect(await adminListBookings(conn.db, { status: "nope" }, NOW)).toMatchObject({ status: 400 });
  });

  it("allows only valid status changes, and audits each one", async () => {
    const r = await create();
    if (!r.ok) throw new Error(r.message);
    const [row] = await conn.db.select().from(bookings).where(eq(bookings.ref, r.booking.ref));
    const id = row!.id;
    expect(await adminTransition(conn.db, staffId, { id, action: "complete" })).toMatchObject({ code: "bad_transition" });
    expect(await adminTransition(conn.db, staffId, { id, action: "confirm" })).toMatchObject({ ok: true, event: { type: "booking.confirmed" } });
    expect(await adminTransition(conn.db, staffId, { id, action: "confirm" })).toMatchObject({ code: "bad_transition" });
    expect(await adminTransition(conn.db, staffId, { id, action: "complete" })).toMatchObject({ ok: true, booking: { status: "completed" } });
    const audit = await conn.db.select().from(auditLog).where(eq(auditLog.entityId, r.booking.ref));
    expect(audit.map((a) => [a.action, a.userId])).toEqual([
      ["booking.confirm", staffId],
      ["booking.complete", staffId],
    ]);
  });

  it("a hold reports the bookings it overlaps, can't be duplicated, and can be removed", async () => {
    const r = await create({ table: "VIP-2", time: "22:00" });
    if (!r.ok) throw new Error(r.message);
    const h = await createHold(conn.db, staffId, { zone: "vip", date: "2026-12-04", reason: "Launch party" });
    expect(h).toMatchObject({ ok: true, conflicts: [{ ref: r.booking.ref, table: "VIP-2", time: "22:00" }] });
    expect(await createHold(conn.db, staffId, { zone: "vip", date: "2026-12-04", reason: "again" })).toMatchObject({ code: "already_held" });
    expect(await createHold(conn.db, staffId, { table: "T1", zone: "vip", date: "2026-12-04", reason: "x" })).toMatchObject({ status: 400 });
    expect(await deleteHold(conn.db, staffId, h.ok ? h.hold.id : 0)).toEqual({ ok: true });
    expect((await create({ table: "VIP-1" })).ok).toBe(true);
  });
});

describe("n8n webhook", () => {
  const payload = {
    ref: "HYD-AB23", status: "pending", table: "T4", zone: "standard", service_date: "2026-12-04", time: "21:00",
    starts_at: "2026-12-04T15:30:00.000Z", ends_at: "2026-12-04T17:30:00.000Z", guests: 4, name: "Asha", phone_e164: "+919876543210", notes: null,
  };
  let server: Server;
  let url = "";
  let replies: number[] = [];
  const received: { sig: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ sig: String(req.headers["x-hydra-signature"]), body });
        res.statusCode = replies.shift() ?? 200;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    received.length = 0;
  });

  it("signs the exact body with HMAC-SHA256 over 't.body'", async () => {
    expect(await deliverBookingEvent(conn.db, "booking.created", payload, { url, secret: "s3cret" })).toBe("delivered");
    const { sig, body } = received[0]!;
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(createHmac("sha256", "s3cret").update(`${t}.${body}`).digest("hex")).toBe(v1);
    expect(signPayload("s3cret", body, Number(t))).toBe(sig);
    expect(JSON.parse(body)).toMatchObject({ type: "booking.created", booking: { ref: "HYD-AB23" } });
  });

  it("retries 5xx and succeeds", async () => {
    replies = [500, 503, 200];
    expect(await deliverBookingEvent(conn.db, "booking.created", payload, { url, secret: "k", retryDelaysMs: [5, 5, 5] })).toBe("delivered");
    expect(received).toHaveLength(3);
  });

  it("gives up on a 4xx at once and audits the failure without guest details", async () => {
    replies = [401];
    expect(await deliverBookingEvent(conn.db, "booking.created", payload, { url, secret: "k", retryDelaysMs: [5, 5, 5] })).toBe("failed");
    expect(received).toHaveLength(1);
    const [entry] = await conn.db.select().from(auditLog).where(eq(auditLog.action, "webhook.failed"));
    expect(entry).toMatchObject({ entityId: "HYD-AB23", diff: { event: "booking.created", error: "HTTP 401" } });
    expect(JSON.stringify(entry)).not.toContain("9876543210");
  });

  it("survives an unreachable n8n and does nothing when not configured", async () => {
    const dead = "http://127.0.0.1:9/hook";
    expect(await deliverBookingEvent(conn.db, "booking.created", payload, { url: dead, secret: "k", retryDelaysMs: [5, 5] })).toBe("failed");
    expect(await deliverBookingEvent(conn.db, "booking.created", payload, { url: "", secret: "" })).toBe("not_configured");
  });
});
