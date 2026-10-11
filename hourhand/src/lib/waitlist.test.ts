// The waitlist: day bounds, checks, and (with TEST_DATABASE_URL) the emails a cancel or a move queues. Uses its own
// database <name>_wait.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { seed } from "../../scripts/seed";
import { isIanaTimeZone } from "./booking";
import { createPgStore } from "./data/pg-store";
import type { DataStore, EventType, User } from "./data/types";
import { processDueNotifications } from "./jobs/worker";
import type { Mail } from "./mail/mailer";
import { createRateLimiter } from "./rate-limit";
import { dayWindow, joinWaitlist, pruneWaitlist, validateWaitlist } from "./waitlist";
import { handleJoinWaitlist } from "./waitlist-handler";

const BASE = process.env.TEST_DATABASE_URL;
const now = new Date("2031-03-01T06:00:00Z");

describe("a guest's day", () => {
  it("is midnight to midnight in their zone", () => {
    expect(dayWindow("2031-03-05", "Asia/Kolkata")).toEqual({ start: new Date("2031-03-04T18:30:00Z"), end: new Date("2031-03-05T18:30:00Z") });
    expect(dayWindow("2031-03-05", "Europe/London")).toEqual({ start: new Date("2031-03-05T00:00:00Z"), end: new Date("2031-03-06T00:00:00Z") });
    expect(dayWindow("2031-02-30", "Asia/Kolkata")).toBeNull();
    expect(dayWindow("5 March", "Asia/Kolkata")).toBeNull();
  });

  it("must be a day the guest could still book", () => {
    const ok = { day: "2031-03-05", timezone: "Asia/Kolkata", name: "Meera", email: "meera@example.in" };
    expect(validateWaitlist(ok, now, 60, isIanaTimeZone).ok).toBe(true);
    const fields = (input: Record<string, unknown>, days = 60) => { const v = validateWaitlist(input, now, days, isIanaTimeZone); return v.ok ? {} : v.fields; };
    expect(fields({ ...ok, day: "2031-02-27" })).toHaveProperty("day");
    expect(fields(ok, 2)).toHaveProperty("day");
    expect(fields({ ...ok, timezone: "Mars/Base" })).toHaveProperty("timezone");
    expect(fields({ ...ok, email: "nope", name: "" })).toMatchObject({ email: expect.any(String), name: expect.any(String) });
  });
});

describe.skipIf(!BASE)("waitlist (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let coaching: EventType;
  let intro: EventType;
  const guest = { name: "Booked Guest", email: "booked@example.in", timezone: "Asia/Kolkata", phone: null, answers: [] };
  const entry = (day: string, email: string, et = coaching) => {
    const v = validateWaitlist({ day, timezone: "Asia/Kolkata", name: email.split("@")[0], email }, now, 3650, isIanaTimeZone);
    if (!v.ok) throw new Error(JSON.stringify(v.fields));
    return joinWaitlist(pool, priya.id, et.id, v.value);
  };
  const queued = async () => (await pool.query("select recipient, dedupe_key, booking_id from notifications where kind = 'waitlist_guest' order by recipient")).rows;

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_wait`;
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
    const types = await store.listEventTypes(priya.id);
    coaching = types.find((e) => e.slug === "coaching")!;
    intro = types.find((e) => e.slug === "intro")!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("emails each guest waiting on that day once when a booking there is cancelled, and only them", async () => {
    await entry("2031-03-05", "asha@example.in");
    await entry("2031-03-05", "asha@example.in"); // joining twice keeps one entry
    await entry("2031-03-05", "bala@example.in");
    await entry("2031-03-06", "chitra@example.in"); // another day
    await entry("2031-03-05", "dev@example.in", intro); // another event type
    expect((await pool.query("select count(*)::int as n from waitlist")).rows[0].n).toBe(4);

    const b = await store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-03-05T05:00:00Z"), idempotencyKey: "wait-1", invitee: guest });
    await store.cancelBooking(priya.id, b.id, "guest");
    expect((await queued()).map((r) => [r.recipient, r.booking_id])).toEqual([["asha@example.in", b.id], ["bala@example.in", b.id]]);

    // A second freed time that day: they already heard, so nothing more goes out.
    const b2 = await store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-03-05T09:00:00Z"), idempotencyKey: "wait-2", invitee: guest });
    await store.cancelBooking(priya.id, b2.id, "host");
    expect(await queued()).toHaveLength(2);
  });

  it("emails them when a booking moves away from their day", async () => {
    const b = await store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-03-06T05:00:00Z"), idempotencyKey: "wait-3", invitee: guest });
    await store.rescheduleBooking(priya.id, b.id, new Date("2031-03-07T05:00:00Z"), "wait-3b");
    expect((await queued()).find((r) => r.recipient === "chitra@example.in")?.booking_id).toBe(b.id);
  });

  it("sends a link straight to the freed time, and nothing once that time has passed", async () => {
    const sent: Mail[] = [];
    const mailer = { async send(m: Mail) { sent.push(m); return { id: `m${sent.length}` }; } };
    // Hold one back to show the past-time skip.
    await pool.query("update notifications set send_at = '2031-03-08T00:00:00Z' where kind = 'waitlist_guest' and recipient = 'chitra@example.in'");
    await processDueNotifications(pool, mailer, { baseUrl: "https://hourhand.test", now });
    const asha = sent.find((m) => m.to === "asha@example.in")!;
    expect(asha.subject).toBe(`A time opened up with ${priya.name}`);
    expect(asha.text).toContain("https://hourhand.test/priya/coaching?at=2031-03-05T05%3A00%3A00.000Z");
    expect(asha.text).toContain("10:30");
    await processDueNotifications(pool, mailer, { baseUrl: "https://hourhand.test", now: new Date("2031-03-08T00:00:00Z") });
    expect(sent.find((m) => m.to === "chitra@example.in")).toBeUndefined();
    expect((await pool.query("select status, last_error from notifications where recipient = 'chitra@example.in'")).rows[0]).toEqual({ status: "skipped", last_error: "the time has passed" });
  });

  it("joins through the handler, which needs Postgres and a public event type", async () => {
    const body = { slug: "priya", event: "coaching", day: "2031-03-10", timezone: "Asia/Kolkata", name: "Esha", email: "esha@example.in" };
    // The seeded event type books 60 days ahead at most; 2031 is far past the real "today", so check against `now`.
    const later = new Date("2031-03-05T00:00:00Z");
    expect((await handleJoinWaitlist(null, store, body, later)).status).toBe(409);
    expect((await handleJoinWaitlist(pool, store, { ...body, event: "nope" }, later)).status).toBe(404);
    expect((await handleJoinWaitlist(pool, store, { ...body, day: "2031-03-01" }, later)).status).toBe(400);
    const limiter = createRateLimiter();
    expect(await handleJoinWaitlist(pool, store, body, later, { clientKey: "ip", limiter })).toEqual({ status: 200, body: { ok: true } });
    expect((await pool.query("select name from waitlist where email = 'esha@example.in'")).rows).toEqual([{ name: "Esha" }]);
  });

  it("lets one address join at most 5 times a week, across hosts, so a stranger can't be signed up everywhere", async () => {
    const at = new Date("2031-03-05T00:00:00Z");
    const join = (day: string) => {
      const v = validateWaitlist({ day, timezone: "Asia/Kolkata", name: "Victim", email: "victim@example.in" }, at, 3650, isIanaTimeZone);
      if (!v.ok) throw new Error("invalid");
      return joinWaitlist(pool, priya.id, coaching.id, v.value, at);
    };
    for (const d of ["2031-03-11", "2031-03-12", "2031-03-13", "2031-03-14", "2031-03-15"]) expect(await join(d)).toBe(true);
    expect(await join("2031-03-16")).toBe(false);
    expect(await join("2031-03-15")).toBe(true); // re-joining a day already on the list is fine
    expect((await pool.query("select count(*)::int as n from waitlist where email = 'victim@example.in'")).rows[0].n).toBe(5);
    await pool.query("delete from waitlist where email = 'victim@example.in'");
  });

  it("forgets guests a day after their day is over", async () => {
    expect(await pruneWaitlist(pool, new Date("2031-03-07T00:00:00Z"))).toBe(3); // asha, bala and dev's 5 March
    expect((await pool.query("select email from waitlist order by email")).rows.map((r) => r.email)).toEqual(["chitra@example.in", "esha@example.in"]);
  });
});
