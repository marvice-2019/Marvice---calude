// Group classes against real Postgres (only with TEST_DATABASE_URL; uses its own database <name>_group).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { seed } from "../../scripts/seed";
import { freeSlotSeats } from "./booking";
import { createPgStore } from "./data/pg-store";
import { SlotTakenError, type DataStore, type EventType, type User } from "./data/types";
import { handleHostReschedule } from "./manage";

const BASE = process.env.TEST_DATABASE_URL;
const guest = (n: number) => ({ name: `Guest ${n}`, email: `g${n}@example.com`, timezone: "Asia/Kolkata", phone: null, answers: [] });
// Tuesday 10:00 IST, inside the seeded weekday hours and far from the seeded bookings.
const CLASS = new Date("2030-03-05T04:30:00Z");

describe.skipIf(!BASE)("group classes (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let yoga: EventType;
  let key = 0;
  const book = (startAt: Date, n: number) => store.createBooking({ eventTypeId: yoga.id, startAt, idempotencyKey: `grp-${++key}`, invitee: guest(n) });
  const calendarJobs = async () =>
    (await pool.query("select booking_id, kind from notifications where channel = 'calendar' and user_id = $1 order by created_at", [priya.id])).rows as { booking_id: string; kind: string }[];

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_group`;
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
    const intro = (await store.listEventTypes(priya.id)).find((e) => e.slug === "intro")!;
    yoga = await store.createEventType(priya.id, {
      name: "Morning yoga", slug: "yoga", description: null, durationMinutes: 60, minNoticeMinutes: 0, bookingWindowDays: 365,
      startIncrementMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dailyLimit: 1, hidden: false, cancelCutoffMinutes: 0,
      priceMinor: null, currency: intro.currency, maxRepeats: 1, depositMinor: null, redirectUrl: null, weeklyLimit: null, cancelPolicy: null,
      seatLimit: 3, location: null,
    });
    // Priya's seeded add-to calendar, made usable, so calendar jobs are queued.
    await pool.query(
      "update calendar_connections set credentials_encrypted = 'x', status = 'ok', last_synced_at = '2030-03-01T00:00:00Z' where id in (select connection_id from calendars where user_id = $1 and is_add_to)", [priya.id]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const seatsAt = async (start: Date) => {
    const slots = await freeSlotSeats(store, priya, yoga, new Date(start.getTime() - 3_600_000), new Date(start.getTime() + 7_200_000), new Date("2030-03-01T00:00:00Z"));
    return slots.find((s) => s.start.getTime() === start.getTime())?.seatsLeft;
  };

  it("is a group type with its seat limit", () => {
    expect(yoga.kind).toBe("group");
    expect(yoga.seatLimit).toBe(3);
  });

  it("lets guests share one class, counting the seats left, and refuses the fourth", async () => {
    expect(await seatsAt(CLASS)).toBe(3);
    const first = await book(CLASS, 1);
    expect(first.classKey).toBe(`${yoga.id}@${CLASS.toISOString()}`);
    expect(await seatsAt(CLASS)).toBe(2);
    await book(CLASS, 2);
    await book(CLASS, 3);
    expect(await seatsAt(CLASS)).toBeUndefined(); // full: no longer offered
    await expect(book(CLASS, 4)).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("writes one calendar event for the whole class", async () => {
    const creates = (await calendarJobs()).filter((j) => j.kind === "calendar_create");
    expect(creates).toHaveLength(1);
  });

  it("counts a class once toward the daily limit, and blocks a second class that day", async () => {
    // The daily limit is 1: the class at 10:00 is that one, so another start the same day is refused.
    expect(await seatsAt(new Date("2030-03-05T08:30:00Z"))).toBeUndefined();
    await expect(book(new Date("2030-03-05T08:30:00Z"), 9)).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("keeps the class and its calendar event when one seat cancels, and deletes the event with the last seat", async () => {
    const seats = (await store.listBookings(priya.id)).filter((b) => b.classKey === `${yoga.id}@${CLASS.toISOString()}` && b.status === "confirmed");
    expect(seats).toHaveLength(3);
    const holder = (await calendarJobs()).find((j) => j.kind === "calendar_create")!.booking_id;
    // The calendar worker would have written the event on the seat that queued it.
    await pool.query("update bookings set external_event_id = 'evt-1', external_calendar_id = (select id from calendars where user_id = $2 and is_add_to) where id = $1", [holder, priya.id]);

    await store.cancelBooking(priya.id, holder, "guest");
    expect(await seatsAt(CLASS)).toBe(1);
    expect((await calendarJobs()).some((j) => j.kind === "calendar_delete")).toBe(false);
    const rest = seats.filter((s) => s.id !== holder);
    const moved = (await pool.query("select id from bookings where external_event_id = 'evt-1' and status = 'confirmed'")).rows;
    expect(moved).toHaveLength(1);
    expect(rest.map((s) => s.id)).toContain(moved[0].id);

    for (const s of rest) await store.cancelBooking(priya.id, s.id, "guest");
    expect((await calendarJobs()).filter((j) => j.kind === "calendar_delete")).toHaveLength(1);
    expect(await seatsAt(CLASS)).toBe(3);
  });

  it("gives the last seat to exactly one of two guests booking at once", async () => {
    const at = new Date("2030-03-06T04:30:00Z");
    await book(at, 11);
    await book(at, 12);
    const results = await Promise.allSettled([book(at, 13), book(at, 14)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof SlotTakenError)).toHaveLength(1);
  });

  it("does not let a class overlap a one-on-one booking", async () => {
    const coaching = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!;
    const at = new Date("2030-03-07T04:30:00Z");
    await store.createBooking({ eventTypeId: coaching.id, startAt: at, idempotencyKey: "grp-solo", invitee: guest(20) });
    await expect(book(at, 21)).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("refuses to move a single seat", async () => {
    const at = new Date("2030-03-08T04:30:00Z");
    const seat = await book(at, 30);
    const res = await handleHostReschedule(store, priya.id, seat.id, { start: "2030-03-08T06:30:00Z", idempotencyKey: "grp-move" }, new Date("2030-03-01T00:00:00Z"));
    expect(res).toMatchObject({ status: 409, body: { error: "group_seat" } });
  });
});
