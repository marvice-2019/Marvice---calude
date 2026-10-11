// Integration tests for the Postgres store. They run only when TEST_DATABASE_URL points at a database named for tests;
// that database is dropped and recreated from the migrations and the seed on every run.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "./pg-store";
import { NotFoundError, RequestKeyConflictError, SlotTakenError, SlugTakenError, type DataStore, type EventType, type EventTypeDraft, type User } from "./types";

const URL_ = process.env.TEST_DATABASE_URL;
const MIN = 60_000;
const guest = { name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: null, answers: [] };
/** Far from the seeded bookings, which sit around the real "now". */
const at = (iso: string) => new Date(iso);

describe.skipIf(!URL_)("pg store (TEST_DATABASE_URL)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let arun: User;
  let coaching: EventType;
  let intro: EventType;

  beforeAll(async () => {
    const url = new URL(URL_!);
    const name = url.pathname.slice(1);
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.query(`create database ${name}`);
    } finally {
      await admin.end();
    }
    await migrate(URL_!);
    await seed(URL_!);
    pool = new pg.Pool({ connectionString: URL_ });
    store = createPgStore(pool);
    priya = (await store.getUserBySlug("priya"))!;
    arun = (await store.getUserBySlug("arun"))!;
    const types = await store.listEventTypes(priya.id);
    coaching = types.find((e) => e.slug === "coaching")!;
    intro = types.find((e) => e.slug === "intro")!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("re-running the migrations applies nothing", async () => {
    expect(await migrate(URL_!)).toEqual([]);
  });

  describe("createBooking", () => {
    it("books a free slot, rejects the same slot under a new key, and returns the same booking for a repeated key", async () => {
      const input = { eventTypeId: coaching.id, startAt: at("2030-01-07T04:00:00Z"), idempotencyKey: "pg-happy-1", invitee: guest };
      const booking = await store.createBooking(input);
      expect(booking).toMatchObject({ hostId: priya.id, eventTypeId: coaching.id, status: "confirmed" });
      expect(booking.endAt.getTime() - booking.startAt.getTime()).toBe(45 * MIN);
      expect(booking.invitee.manageToken).toBeTruthy();

      await expect(store.createBooking({ ...input, idempotencyKey: "pg-happy-2" })).rejects.toBeInstanceOf(SlotTakenError);
      const again = await store.createBooking(input);
      expect(again.id).toBe(booking.id);
      expect((await store.listBookings(priya.id)).filter((b) => b.idempotencyKey === "pg-happy-1")).toHaveLength(1);
    });

    it("lets exactly one of two parallel bookings for one slot through", async () => {
      const startAt = at("2030-01-08T04:00:00Z");
      const results = await Promise.allSettled([
        store.createBooking({ eventTypeId: coaching.id, startAt, idempotencyKey: "pg-race-a", invitee: guest }),
        store.createBooking({ eventTypeId: coaching.id, startAt, idempotencyKey: "pg-race-b", invitee: guest }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(SlotTakenError);
    });
  });

  describe("rescheduleBooking", () => {
    it("moves the booking, frees the old slot, and returns the same booking for a repeated key", async () => {
      const old = await store.createBooking({ eventTypeId: coaching.id, startAt: at("2030-01-09T04:00:00Z"), idempotencyKey: "pg-move-1", invitee: guest });
      const moved = await store.rescheduleBooking(priya.id, old.id, at("2030-01-09T08:00:00Z"), "pg-move-1b");
      expect(moved).toMatchObject({ status: "confirmed", rescheduledFromId: old.id, startAt: at("2030-01-09T08:00:00Z") });
      expect((await store.getBooking(priya.id, old.id))!.status).toBe("cancelled");

      const retry = await store.rescheduleBooking(priya.id, old.id, at("2030-01-09T08:00:00Z"), "pg-move-1b");
      expect(retry.id).toBe(moved.id);

      const reuse = await store.createBooking({ eventTypeId: coaching.id, startAt: at("2030-01-09T04:00:00Z"), idempotencyKey: "pg-move-1c", invitee: guest });
      expect(reuse.status).toBe("confirmed");
    });

    it("moves to a slot that overlaps the booking's own old slot", async () => {
      const old = await store.createBooking({ eventTypeId: coaching.id, startAt: at("2030-01-10T04:00:00Z"), idempotencyKey: "pg-overlap-1", invitee: guest });
      const moved = await store.rescheduleBooking(priya.id, old.id, at("2030-01-10T04:15:00Z"), "pg-overlap-2");
      expect(moved).toMatchObject({ status: "confirmed", startAt: at("2030-01-10T04:15:00Z") });
    });

    it("a failed reschedule leaves the old booking confirmed", async () => {
      const old = await store.createBooking({ eventTypeId: coaching.id, startAt: at("2030-01-11T04:00:00Z"), idempotencyKey: "pg-fail-1", invitee: guest });
      await store.createBooking({ eventTypeId: coaching.id, startAt: at("2030-01-11T08:00:00Z"), idempotencyKey: "pg-fail-other", invitee: guest });
      await expect(store.rescheduleBooking(priya.id, old.id, at("2030-01-11T08:00:00Z"), "pg-fail-2")).rejects.toBeInstanceOf(SlotTakenError);
      expect((await store.getBooking(priya.id, old.id))!.status).toBe("confirmed");
    });
  });

  describe("isolation: acting as Arun", () => {
    it("reads that take a user id return nothing of Priya's", async () => {
      const priyaBooking = (await store.getBookingByManageToken("tok_bkg_1"))!;
      expect(priyaBooking.hostId).toBe(priya.id);
      const priyaSchedule = await store.getDefaultSchedule(priya.id);

      const arunTypes = await store.listEventTypes(arun.id);
      expect(arunTypes.map((e) => e.slug)).toEqual(["chat"]);
      expect(await store.getEventType(arun.id, coaching.id)).toBeNull();

      const arunBookings = await store.listBookings(arun.id);
      expect(arunBookings.length).toBeGreaterThan(0);
      expect(arunBookings.every((b) => b.hostId === arun.id)).toBe(true);
      expect(await store.getBooking(arun.id, priyaBooking.id)).toBeNull();

      const arunSchedule = await store.getDefaultSchedule(arun.id);
      expect(arunSchedule.schedule.id).not.toBe(priyaSchedule.schedule.id);
      expect(arunSchedule.schedule.userId).toBe(arun.id);
      expect(arunSchedule.rules.every((r) => r.scheduleId === arunSchedule.schedule.id)).toBe(true);
    });

    it("cannot update, deactivate or delete Priya's event type", async () => {
      const before = (await store.getEventType(priya.id, intro.id))!;
      await expect(store.updateEventType(arun.id, intro.id, { ...draftOf(before), name: "Hijacked" })).rejects.toThrow();
      await expect(store.setEventTypeActive(arun.id, intro.id, false)).rejects.toThrow();
      await expect(store.deleteEventType(arun.id, intro.id)).rejects.toThrow();
      expect(await store.getEventType(priya.id, intro.id)).toEqual(before);
    });

    it("cannot read Priya's locations or questions, nor overwrite her questions", async () => {
      expect((await store.listCustomQuestions(priya.id, coaching.id)).length).toBeGreaterThan(0);
      expect(await store.listCustomQuestions(arun.id, coaching.id)).toEqual([]);
      expect(await store.listEventLocations(arun.id, coaching.id)).toEqual([]);
      const before = await store.listCustomQuestions(priya.id, coaching.id);
      await expect(store.saveQuestions(arun.id, coaching.id, [])).rejects.toBeInstanceOf(NotFoundError);
      expect(await store.listCustomQuestions(priya.id, coaching.id)).toEqual(before);
    });

    it("cannot cancel or move Priya's booking", async () => {
      const priyaBooking = (await store.getBookingByManageToken("tok_bkg_1"))!;
      await expect(store.cancelBooking(arun.id, priyaBooking.id, "host")).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.rescheduleBooking(arun.id, priyaBooking.id, at("2030-02-01T04:00:00Z"), "pg-hijack-1")).rejects.toBeInstanceOf(NotFoundError);
      const after = (await store.getBooking(priya.id, priyaBooking.id))!;
      expect(after.status).toBe(priyaBooking.status);
      expect(after.startAt).toEqual(priyaBooking.startAt);
    });

    it("cannot get Priya's booking back by replaying its request key", async () => {
      const priyaBooking = await store.createBooking({ eventTypeId: coaching.id, startAt: at("2030-02-03T04:00:00Z"), idempotencyKey: "pg-priya-key-1", invitee: guest });
      const arunType = (await store.listEventTypes(arun.id))[0];
      const arunBooking = (await store.getBookingByManageToken("tok_bkg_arun_1"))!;
      await expect(store.createBooking({ eventTypeId: arunType.id, startAt: at("2030-02-04T04:00:00Z"), idempotencyKey: "pg-priya-key-1", invitee: guest }))
        .rejects.toBeInstanceOf(RequestKeyConflictError);
      await expect(store.rescheduleBooking(arun.id, arunBooking.id, at("2030-02-05T04:00:00Z"), "pg-priya-key-1")).rejects.toBeInstanceOf(RequestKeyConflictError);
      expect((await store.getBooking(priya.id, priyaBooking.id))!.status).toBe("confirmed");
      expect((await store.getBooking(arun.id, arunBooking.id))!.status).toBe(arunBooking.status);
    });

    it("cannot change Priya's hours or overrides", async () => {
      const { schedule, rules } = await store.getDefaultSchedule(priya.id);
      await expect(store.saveWeeklyHours(arun.id, schedule.id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.saveDateOverride(arun.id, schedule.id, "2030-03-01", [])).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.blockDateRange(arun.id, schedule.id, "2030-03-01", "2030-03-07")).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.deleteDateOverride(arun.id, schedule.id, "2030-03-01")).rejects.toBeInstanceOf(NotFoundError);
      expect((await store.getDefaultSchedule(priya.id)).rules).toEqual(rules);
    });
  });

  describe("event types and questions", () => {
    it("rejects a duplicate slug for the same host, ignoring case", async () => {
      await expect(store.createEventType(priya.id, { ...draftOf(intro), slug: "Coaching" })).rejects.toBeInstanceOf(SlugTakenError);
      const created = await store.createEventType(arun.id, { ...draftOf(intro), slug: "coaching" });
      expect(created.userId).toBe(arun.id);
    });

    it("stores a price in paise with its currency, and clears both for a free event", async () => {
      const priced = await store.updateEventType(priya.id, intro.id, { ...draftOf(intro), priceMinor: 49950, currency: "INR" });
      expect([priced.priceMinor, priced.currency]).toEqual([49950, "INR"]);
      const reread = (await store.getEventType(priya.id, intro.id))!;
      expect([reread.priceMinor, reread.currency]).toEqual([49950, "INR"]);
      const free = await store.updateEventType(priya.id, intro.id, { ...draftOf(intro), priceMinor: null, currency: null });
      expect([free.priceMinor, free.currency]).toEqual([null, null]);
    });

    it("round-trips questions in order with required flags, replacing an id from another event type", async () => {
      const [coachingQuestion] = await store.listCustomQuestions(priya.id, coaching.id);
      const saved = await store.saveQuestions(priya.id, intro.id, [
        { id: coachingQuestion.id, label: "Company", kind: "short_text", required: false, choices: [] },
        { id: null, label: "What brings you here?", kind: "long_text", required: true, choices: [] },
      ]);
      expect(saved[0].id).not.toBe(coachingQuestion.id);
      const listed = await store.listCustomQuestions(priya.id, intro.id);
      expect(listed.map((q) => [q.label, q.required, q.position])).toEqual([["Company", false, 0], ["What brings you here?", true, 1]]);
      expect(listed.map((q) => q.id)).toEqual(saved.map((q) => q.id));
      expect((await store.listCustomQuestions(priya.id, coaching.id)).map((q) => q.id)).toEqual([coachingQuestion.id]);

      const resaved = await store.saveQuestions(priya.id, intro.id, [...listed].reverse().map(({ id, label, kind, required, choices }) => ({ id, label, kind, required, choices })));
      expect(resaved.map((q) => q.id)).toEqual([listed[1].id, listed[0].id]);
    });
  });

  // Runs last: it closes and then purges Arun's account.
  describe("account deletion", () => {
    it("closes the account at once and purges it only after 30 days", async () => {
      const now = at("2030-06-01T00:00:00Z");
      const upcoming = await store.createBooking({
        eventTypeId: (await store.listEventTypes(arun.id))[0].id, startAt: at("2030-06-05T04:00:00Z"), idempotencyKey: "pg-delete-upcoming", invitee: guest,
      });
      await pool.query("insert into auth_sessions (token, user_id, expires_at) values ('pg-delete-session', $1, now() + interval '1 day')", [arun.id]);
      // A paid booking: payments.booking_id is "on delete restrict", so the purge must still get through it.
      await pool.query("insert into payments (booking_id, host_id, provider, amount_minor, currency, status) values ($1, $2, 'razorpay', 49900, 'INR', 'paid')",
        [upcoming.id, arun.id]);

      const cancelled = await store.deleteAccount(arun.id, now);
      expect(cancelled.map((b) => b.id)).toContain(upcoming.id);
      expect(cancelled.every((b) => b.status === "cancelled" && b.cancelledBy === "host")).toBe(true);
      expect(await store.getUserBySlug("arun")).toBeNull();
      expect(await store.getUser(arun.id)).toBeNull();
      expect(await store.getPublicEventType("arun", "chat")).toBeNull();
      expect((await pool.query("select count(*)::int as n from auth_sessions where user_id = $1", [arun.id])).rows[0].n).toBe(0);
      await expect(store.deleteAccount(arun.id, now)).rejects.toBeInstanceOf(NotFoundError);
      expect(await store.getUserBySlug("priya")).not.toBeNull();

      expect(await store.purgeDeletedAccounts(at("2030-06-30T00:00:00Z"))).toBe(0); // 29 days: still recoverable
      expect((await pool.query("select count(*)::int as n from bookings where host_id = $1", [arun.id])).rows[0].n).toBeGreaterThan(0);

      // The guest who paid is owed a refund, and the purge waits for it: deleting would lose the payment row.
      expect((await pool.query("select status from payments where booking_id = $1", [upcoming.id])).rows[0].status).toBe("refund_pending");
      expect(await store.purgeDeletedAccounts(at("2030-07-02T00:00:00Z"))).toBe(0);
      await pool.query("update payments set status = 'refunded' where booking_id = $1", [upcoming.id]);
      expect(await store.purgeDeletedAccounts(at("2030-07-02T00:00:00Z"))).toBe(1);
      for (const table of ["users", "event_types", "bookings", "invitees", "availability_schedules"]) {
        const column = table === "users" ? "id" : table === "bookings" || table === "invitees" ? "host_id" : "user_id";
        const { rows } = await pool.query(`select count(*)::int as n from ${table} where ${column} = $1`, [arun.id]);
        expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
      }
      expect((await store.listBookings(priya.id)).length).toBeGreaterThan(0);
    });
  });
  describe("host actions", () => {
    const notifications = async (id: string) => (await pool.query("select * from notifications where booking_id = $1", [id])).rows.map((r) => JSON.stringify(r));
    const pay = (b: { id: string }) => pool.query("insert into payments (booking_id, host_id, provider, amount_minor, currency, status) values ($1, $2, 'razorpay', 50000, 'INR', 'paid')", [b.id, priya.id]);
    const paymentOf = async (id: string) => (await pool.query("select booking_id, status from payments where booking_id = $1", [id])).rows;
    const book = (iso: string, key: string) => store.createBooking({ eventTypeId: coaching.id, startAt: at(iso), idempotencyKey: key, invitee: guest });

    it("host cancel records the host, queues the cancellation emails and refunds a paid booking", async () => {
      const b = await book("2030-03-04T04:00:00Z", "pg-host-cancel-1");
      await pay(b);
      await expect(store.cancelBooking(arun.id, b.id, "host")).rejects.toBeInstanceOf(NotFoundError);
      expect(await store.cancelBooking(priya.id, b.id, "host", "Called away")).toMatchObject({ status: "cancelled", cancelledBy: "host", cancelReason: "Called away" });
      expect((await notifications(b.id)).filter((n) => n.includes("cancelled")).length).toBeGreaterThan(0);
      expect(await paymentOf(b.id)).toEqual([{ booking_id: b.id, status: "refund_pending" }]);
    });

    it("host reschedule records the host on the old booking, carries the payment over and refuses a taken slot", async () => {
      const old = await book("2030-03-05T04:00:00Z", "pg-host-move-1");
      await pay(old);
      const taken = await book("2030-03-05T10:00:00Z", "pg-host-move-taken");
      await expect(store.rescheduleBooking(arun.id, old.id, at("2030-03-05T08:00:00Z"), "pg-host-move-x", "host")).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.rescheduleBooking(priya.id, old.id, taken.startAt, "pg-host-move-2", "host")).rejects.toBeInstanceOf(SlotTakenError);
      const moved = await store.rescheduleBooking(priya.id, old.id, at("2030-03-05T08:00:00Z"), "pg-host-move-3", "host");
      expect(moved).toMatchObject({ status: "confirmed", rescheduledFromId: old.id });
      expect(await store.getBooking(priya.id, old.id)).toMatchObject({ status: "cancelled", cancelledBy: "host" });
      expect(await paymentOf(moved.id)).toEqual([{ booking_id: moved.id, status: "paid" }]);
    });

    it("no-show is only set after the start, toggles both ways, and only on the host's own booking", async () => {
      const b = await book("2030-03-06T04:00:00Z", "pg-no-show-1");
      const after = at("2030-03-06T04:30:00Z");
      await expect(store.setNoShow(priya.id, b.id, true, at("2030-03-06T03:59:00Z"))).rejects.toBeInstanceOf(NotFoundError);
      await expect(store.setNoShow(arun.id, b.id, true, after)).rejects.toBeInstanceOf(NotFoundError);
      expect((await store.getBooking(priya.id, b.id))!.invitee.noShowAt).toBeNull();
      expect((await store.setNoShow(priya.id, b.id, true, after)).invitee.noShowAt).toEqual(after);
      expect((await store.setNoShow(priya.id, b.id, false, after)).invitee.noShowAt).toBeNull();
    });
  });
});

function draftOf(e: EventType): EventTypeDraft {
  return {
    name: e.name, slug: e.slug, description: e.description, durationMinutes: e.durationMinutes, minNoticeMinutes: e.minNoticeMinutes, bookingWindowDays: e.bookingWindowDays,
    startIncrementMinutes: e.startIncrementMinutes, bufferBeforeMinutes: e.bufferBeforeMinutes, bufferAfterMinutes: e.bufferAfterMinutes, dailyLimit: e.dailyLimit,
    cancelCutoffMinutes: e.cancelCutoffMinutes, priceMinor: e.priceMinor, currency: e.currency, location: null,
  };
}
