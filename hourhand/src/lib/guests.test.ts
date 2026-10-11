// Extra guests on a booking: the checks, and (with TEST_DATABASE_URL, own database <name>_guests) what they're sent.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { seed } from "../../scripts/seed";
import { validateBookingRequest } from "./booking";
import { createPgStore } from "./data/pg-store";
import type { DataStore, EventType, User } from "./data/types";
import { processDueNotifications } from "./jobs/worker";
import type { Mail } from "./mail/mailer";

const BASE = process.env.TEST_DATABASE_URL;
const base = { slug: "priya", event: "coaching", start: "2031-04-01T05:00:00.000Z", name: "Meera", email: "meera@example.in", timezone: "Asia/Kolkata", idempotencyKey: "guests-key-1" };
const guestsOf = (input: Record<string, unknown>) => { const v = validateBookingRequest({ ...base, ...input }); return v.ok ? v.value.guests : v.fields; };

describe("extra guests, as sent", () => {
  it("keeps up to 5 distinct addresses, dropping the booker's own", () => {
    expect(guestsOf({})).toEqual([]);
    expect(guestsOf({ guests: [" ravi@example.in ", "RAVI@example.in", "Meera@Example.in", "", "anu@example.in"] })).toEqual(["ravi@example.in", "anu@example.in"]);
  });

  it("refuses a bad address, more than 5, or anything but a list of text", () => {
    expect(guestsOf({ guests: ["not-an-email"] })).toHaveProperty("guests");
    expect(guestsOf({ guests: ["a@x.in", "b@x.in", "c@x.in", "d@x.in", "e@x.in", "f@x.in"] })).toHaveProperty("guests");
    expect(guestsOf({ guests: "a@x.in" })).toHaveProperty("guests");
    expect(guestsOf({ guests: [42] })).toHaveProperty("guests");
  });
});

describe.skipIf(!BASE)("extra guests (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let coaching: EventType;

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_guests`;
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
    coaching = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("stores the guests, keeps them through a move, and the database holds at most 5", async () => {
    const invitee = { name: "Meera", email: "meera@example.in", timezone: "Asia/Kolkata", phone: null, answers: [], guests: ["ravi@example.in", "anu@example.in"] };
    const b = await store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-04-01T05:00:00Z"), idempotencyKey: "guests-1", invitee });
    expect(b.invitee.guests).toEqual(["ravi@example.in", "anu@example.in"]);
    const moved = await store.rescheduleBooking(priya.id, b.id, new Date("2031-04-02T05:00:00Z"), "guests-1-move");
    expect(moved.invitee.guests).toEqual(["ravi@example.in", "anu@example.in"]);
    await expect(store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-04-03T05:00:00Z"), idempotencyKey: "guests-2",
      invitee: { ...invitee, guests: ["a@x.in", "b@x.in", "c@x.in", "d@x.in", "e@x.in", "f@x.in"] } })).rejects.toThrow();
  });

  it("remembers the language the guest booked in, through a move", async () => {
    const b = await store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-06-01T05:00:00Z"), idempotencyKey: "locale-1",
      invitee: { name: "Kiran", email: "kiran@example.in", timezone: "Asia/Kolkata", phone: null, answers: [], locale: "ta" } });
    expect(b.invitee.locale).toBe("ta");
    expect((await store.rescheduleBooking(priya.id, b.id, new Date("2031-06-02T05:00:00Z"), "locale-1-move")).invitee.locale).toBe("ta");
    await expect(store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-06-03T05:00:00Z"), idempotencyKey: "locale-2",
      invitee: { name: "Kiran", email: "kiran@example.in", timezone: "Asia/Kolkata", phone: null, answers: [], locale: "fr" } })).rejects.toThrow();
  });

  it("sends each extra guest the news, never the link that changes the booking", async () => {
    await pool.query("delete from notifications");
    const invitee = { name: "Meera", email: "meera@example.in", timezone: "Asia/Kolkata", phone: null, answers: [], guests: ["ravi@example.in"] };
    const b = await store.createBooking({ eventTypeId: coaching.id, startAt: new Date("2031-05-01T05:00:00Z"), idempotencyKey: "guests-3", invitee });
    const { rows } = await pool.query("select recipient, kind from notifications where booking_id = $1 and channel = 'email' order by kind, recipient", [b.id]);
    expect(rows.filter((r) => r.kind === "booked_guest").map((r) => r.recipient)).toEqual(["meera@example.in", "ravi@example.in"]);
    expect(rows.filter((r) => r.kind === "reminder_guest").map((r) => r.recipient)).toContain("ravi@example.in");

    const sent: Mail[] = [];
    await processDueNotifications(pool, { async send(m) { sent.push(m); return { id: `m${sent.length}` }; } }, { baseUrl: "https://hourhand.test", now: new Date() });
    const booker = sent.find((m) => m.to === "meera@example.in" && m.subject.startsWith("Booked"))!;
    const extra = sent.find((m) => m.to === "ravi@example.in")!;
    expect(booker.text).toContain(`/b/${b.invitee.manageToken}`);
    expect(extra.subject).toMatch(/^Invitation: /);
    expect(extra.text).toContain("Meera added you");
    expect(extra.text).not.toContain(b.invitee.manageToken);
    const ics = Buffer.from(extra.attachments![0].content, "base64").toString();
    expect(ics).not.toContain(b.invitee.manageToken);
    expect(ics).toContain(`UID:${b.id}@hourhand`);

    await store.cancelBooking(priya.id, b.id, "guest");
    await processDueNotifications(pool, { async send(m) { sent.push(m); return { id: `m${sent.length}` }; } }, { baseUrl: "https://hourhand.test", now: new Date() });
    expect(sent.filter((m) => m.to === "ravi@example.in" && m.subject.startsWith("Cancelled"))).toHaveLength(1);
  });
});
