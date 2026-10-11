// Integration tests for the Postgres store. They run only when TEST_DATABASE_URL points at a database named for tests;
// that database is dropped and recreated from the migrations and the seed on every run.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "./pg-store";
import { LinkUsedError, NotFoundError, RequestKeyConflictError, SlotTakenError, SlugTakenError, type DataStore, type EventType, type EventTypeDraft, type User } from "./types";

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

    it("stores and clears the page guests go to after booking", async () => {
      const set = await store.updateEventType(priya.id, intro.id, { ...draftOf(intro), redirectUrl: "https://priya.coach/thanks" });
      expect((await store.getEventType(priya.id, intro.id))!.redirectUrl).toBe("https://priya.coach/thanks");
      expect((await store.updateEventType(priya.id, intro.id, { ...draftOf(set), redirectUrl: null })).redirectUrl).toBeNull();
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
    const pay = (b: { id: string }) => pool.query("insert into payments (booking_id, host_id, provider, amount_minor, currency, status) values ($1, $2, 'razorpay', 50000, 'INR', 'paid')", [b.id, priya.id]);
    const paymentOf = async (id: string) => (await pool.query("select booking_id, status from payments where booking_id = $1", [id])).rows;
    const book = (iso: string, key: string) => store.createBooking({ eventTypeId: coaching.id, startAt: at(iso), idempotencyKey: key, invitee: guest });

    it("host cancel records the host, queues the cancellation emails and refunds a paid booking", async () => {
      const b = await book("2030-03-04T04:00:00Z", "pg-host-cancel-1");
      await pay(b);
      await expect(store.cancelBooking(arun.id, b.id, "host")).rejects.toBeInstanceOf(NotFoundError);
      expect(await store.cancelBooking(priya.id, b.id, "host", "Called away")).toMatchObject({ status: "cancelled", cancelledBy: "host", cancelReason: "Called away" });
      const kinds = (await pool.query("select kind from notifications where booking_id = $1 and status = 'queued'", [b.id])).rows.map((r) => r.kind);
      expect(kinds).toEqual(expect.arrayContaining(["cancelled_guest", "cancelled_host"]));
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

  describe("running late", () => {
    it("records the minutes and queues one host email per answer, however often the guest taps", async () => {
      const booking = await store.createBooking({
        eventTypeId: coaching.id, startAt: at("2034-02-06T04:00:00Z"), idempotencyKey: "pg-late-1", invitee: { ...guest, name: "Late Guest" },
      });
      const token = booking.invitee.manageToken;
      const when = at("2034-02-06T03:45:00Z");
      const tap = (m: number, s: number) => store.markRunningLate(token, m, new Date(when.getTime() + s * 1000));
      await tap(10, 0);
      await tap(10, 1); // a double tap
      await tap(20, 2);
      await tap(10, 3); // changed back: the host must hear it again
      expect((await store.getBookingByManageToken(token))!.invitee).toMatchObject({ runningLateMinutes: 10, runningLateAt: new Date(when.getTime() + 3000) });
      const { rows } = await pool.query("select kind, recipient, dedupe_key from notifications where booking_id = $1 and kind = 'late_host' order by send_at", [booking.id]);
      expect(rows.map((r) => r.dedupe_key.replace(/:\d+$/, ""))).toEqual([10, 20, 10].map((m) => `booking:${booking.id}:late:${m}`));
      expect(rows[0].recipient).toBe(priya.email);
      await store.cancelBooking(priya.id, booking.id, "guest");
      await expect(store.markRunningLate(token, 5, when)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("client notes", () => {
    it("keeps one private note per client per host, matched in any email case; empty removes it", async () => {
      const { rows: [other] } = await pool.query("insert into users (email, name, slug) values ('notes-other@example.com', 'Other Host', 'notes-other') returning id");
      await store.saveClientNote(priya.id, "Meera@Example.com", "Interview prep; prefers mornings.");
      await store.saveClientNote(priya.id, "meera@example.com", "Interview prep; prefers mornings. Paid for 5.");
      expect(await store.getClientNote(priya.id, "MEERA@example.com")).toBe("Interview prep; prefers mornings. Paid for 5.");
      expect(await store.getClientNote(other.id, "meera@example.com")).toBe("");
      await store.saveClientNote(priya.id, "meera@example.com", "");
      expect(await store.getClientNote(priya.id, "meera@example.com")).toBe("");
    });
  });

  describe("weekly series", () => {
    const WEEK = 7 * 86_400_000;
    it("books every week in one write; only the first week sends confirmations, every week gets reminders", async () => {
      const first = await store.createBooking({
        eventTypeId: coaching.id, startAt: at("2034-03-06T04:00:00Z"), idempotencyKey: "pg-series-1", weeks: 3, invitee: { ...guest, name: "Series Guest" },
      });
      expect([first.seriesId, first.seriesIndex]).toEqual([first.id, 1]);
      const { rows } = await pool.query(
        `select b.id, b.series_index, b.start_at, array(select n.kind from notifications n where n.booking_id = b.id and n.channel = 'email' order by n.kind) as kinds
         from bookings b where b.series_id = $1 order by b.series_index`, [first.id]);
      expect(rows.map((r) => r.series_index)).toEqual([1, 2, 3]);
      expect(rows.map((r) => new Date(r.start_at).getTime() - first.startAt.getTime())).toEqual([0, WEEK, 2 * WEEK]);
      expect(rows[0].kinds).toEqual(["booked_guest", "booked_host", "reminder_guest", "reminder_guest"]);
      expect(rows[1].kinds).toEqual(["reminder_guest", "reminder_guest"]);
      // The same request again returns the first week and adds nothing.
      const again = await store.createBooking({ eventTypeId: coaching.id, startAt: at("2034-03-06T04:00:00Z"), idempotencyKey: "pg-series-1", weeks: 3, invitee: guest });
      expect(again.id).toBe(first.id);
      expect((await pool.query("select count(*)::int as n from bookings where series_id = $1", [first.id])).rows[0].n).toBe(3);
    });

    it("a clash in a later week books nothing at all", async () => {
      await store.createBooking({ eventTypeId: coaching.id, startAt: at("2034-04-17T04:00:00Z"), idempotencyKey: "pg-series-blocker", invitee: guest });
      await expect(store.createBooking({
        eventTypeId: coaching.id, startAt: at("2034-04-03T04:00:00Z"), idempotencyKey: "pg-series-2", weeks: 3, invitee: guest,
      })).rejects.toMatchObject({ name: "SlotTakenError" });
      expect((await pool.query("select count(*)::int as n from bookings where idempotency_key like 'pg-series-2%'")).rows[0].n).toBe(0);
    });
  });

  describe("single-use booking links", () => {
    const now = () => new Date();
    let n = 0;
    /** A fresh far-future slot and request key per booking, so link tests never collide on the slot. */
    const book = (eventTypeId: string, token: string | undefined, name = "Meera Iyer") => {
      n += 1;
      return store.createBooking({
        eventTypeId, startAt: new Date(at("2033-01-03T04:00:00Z").getTime() + n * 24 * 60 * MIN), idempotencyKey: `pg-link-${n}`,
        bookingLinkToken: token, invitee: { ...guest, name },
      });
    };
    const stateOf = async (id: string) => (await store.listBookingLinks(priya.id, now())).find((l) => l.id === id)!;

    it("creates an open link, lists it newest first and stores only the token's hash", async () => {
      const first = await store.createBookingLink(priya.id, coaching.id, { label: "For Ravi" }, now());
      const second = await store.createBookingLink(priya.id, intro.id, {}, now());
      expect(first.link).toMatchObject({ eventTypeId: coaching.id, label: "For Ravi", expiresAt: null, revokedAt: null, state: "open", usedBy: null });
      expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const ids = (await store.listBookingLinks(priya.id, now())).map((l) => l.id);
      expect(ids.indexOf(second.link.id)).toBeLessThan(ids.indexOf(first.link.id));
      expect(await store.listBookingLinks(arun.id, now())).not.toContainEqual(expect.objectContaining({ id: first.link.id }));

      const { rows } = await pool.query("select token_hash from booking_links where id = $1", [first.link.id]);
      expect(rows[0].token_hash).not.toBe(first.token);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      const leaked = await pool.query("select count(*)::int as n from booking_links l where l::text like '%' || $1 || '%'", [first.token]);
      expect(leaked.rows[0].n).toBe(0);
    });

    it("won't make a link for another host's event type", async () => {
      await expect(store.createBookingLink(arun.id, coaching.id, {}, now())).rejects.toBeInstanceOf(NotFoundError);
    });

    it("resolves open, unknown, revoked and expired tokens; only open carries the host and event type", async () => {
      const open = await store.createBookingLink(priya.id, coaching.id, {}, now());
      const resolved = await store.resolveBookingLink(open.token, now());
      expect(resolved).toMatchObject({ status: "open", link: { id: open.link.id }, host: { id: priya.id }, eventType: { id: coaching.id } });
      expect(await store.resolveBookingLink("no-such-token", now())).toEqual({ status: "not_found" });

      const revoked = await store.createBookingLink(priya.id, coaching.id, {}, now());
      expect(await store.revokeBookingLink(priya.id, revoked.link.id, now())).toMatchObject({ state: "revoked" });
      expect(await store.resolveBookingLink(revoked.token, now())).toEqual({ status: "revoked" });
      await expect(book(coaching.id, revoked.token)).rejects.toMatchObject({ name: "LinkUnavailableError", status: "revoked" });

      const expired = await store.createBookingLink(priya.id, coaching.id, { expiresAt: at("2020-01-01T00:00:00Z") }, now());
      expect(expired.link.state).toBe("expired");
      expect(await store.resolveBookingLink(expired.token, now())).toEqual({ status: "expired" });
      await expect(book(coaching.id, expired.token)).rejects.toMatchObject({ name: "LinkUnavailableError", status: "expired" });
      await expect(book(coaching.id, "no-such-token")).rejects.toMatchObject({ name: "LinkUnavailableError", status: "not_found" });
    });

    it("revoking another host's link is not found", async () => {
      const { link } = await store.createBookingLink(priya.id, coaching.id, {}, now());
      await expect(store.revokeBookingLink(arun.id, link.id, now())).rejects.toBeInstanceOf(NotFoundError);
      expect((await stateOf(link.id)).state).toBe("open");
    });

    it("booking through a link uses it up; a second booking is LinkUsedError", async () => {
      const { link, token } = await store.createBookingLink(priya.id, coaching.id, {}, now());
      const booking = await book(coaching.id, token, "Ravi Kumar");
      const used = await stateOf(link.id);
      expect(used).toMatchObject({ state: "used", usedBy: { bookingId: booking.id, guestName: "Ravi Kumar", startAt: booking.startAt } });
      expect(await store.resolveBookingLink(token, now())).toEqual({ status: "used" });
      await expect(book(coaching.id, token)).rejects.toBeInstanceOf(LinkUsedError);
      await expect(store.revokeBookingLink(priya.id, link.id, now())).rejects.toBeInstanceOf(NotFoundError);
    });

    it("the same request again (same key) returns its booking instead of LinkUsedError", async () => {
      const { token } = await store.createBookingLink(priya.id, coaching.id, {}, now());
      n += 1;
      const input = {
        eventTypeId: coaching.id, startAt: new Date(at("2033-01-03T04:00:00Z").getTime() + n * 24 * 60 * MIN), idempotencyKey: `pg-link-retry-${n}`,
        bookingLinkToken: token, invitee: { ...guest, name: "Retry Guest" },
      };
      const first = await store.createBooking(input);
      expect((await store.createBooking(input)).id).toBe(first.id);
      await expect(book(coaching.id, token)).rejects.toBeInstanceOf(LinkUsedError);
    });

    it("a payment hold uses the link; once the hold lapses, booking through the link works again", async () => {
      const { link, token } = await store.createBookingLink(priya.id, coaching.id, {}, now());
      n += 1;
      const held = await store.createBooking({
        eventTypeId: coaching.id, startAt: new Date(at("2033-01-03T04:00:00Z").getTime() + n * 24 * 60 * MIN), idempotencyKey: `pg-link-${n}`,
        bookingLinkToken: token, holdUntil: new Date(Date.now() + 15 * MIN), invitee: { ...guest, name: "Held Guest" },
      });
      expect(held.status).toBe("pending_payment");
      expect((await stateOf(link.id)).state).toBe("used");
      await expect(book(coaching.id, token)).rejects.toBeInstanceOf(LinkUsedError);
      // The guest never pays: the hold runs out, and the next booking through the link expires it and goes ahead.
      await pool.query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [held.id]);
      // Before anything sweeps the lapsed hold, the guest reopening the link must see it open, not "already used".
      expect(await store.resolveBookingLink(token, now())).toMatchObject({ status: "open" });
      const after = await book(coaching.id, token, "Second Guest");
      expect(after.status).toBe("confirmed");
      expect(await stateOf(link.id)).toMatchObject({ state: "used", usedBy: { bookingId: after.id } });
    });

    describe("racing bookings", () => {
      // Each insert through a link sleeps, so both racers pass their link check before either commits unless the link row lock serialises them.
      beforeAll(async () => {
        await pool.query(`create or replace function test_slow_link_insert() returns trigger language plpgsql as $$
          begin if new.booking_link_id is not null then perform pg_sleep(0.3); end if; return new; end $$`);
        await pool.query("create trigger test_slow_link_insert before insert on bookings for each row execute function test_slow_link_insert()");
      });
      afterAll(async () => {
        await pool.query("drop trigger if exists test_slow_link_insert on bookings");
        await pool.query("drop function if exists test_slow_link_insert()");
      });

      it("two concurrent bookings on one link: exactly one succeeds, the other is LinkUsedError", async () => {
        const { token } = await store.createBookingLink(priya.id, coaching.id, {}, now());
        const results = await Promise.allSettled([book(coaching.id, token), book(coaching.id, token)]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBeInstanceOf(LinkUsedError);
      });
    });

    it("a booking the system cancelled frees the link; a guest-cancelled one keeps it used", async () => {
      const { link, token } = await store.createBookingLink(priya.id, coaching.id, {}, now());
      const lapsed = await book(coaching.id, token);
      await pool.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system' where id = $1", [lapsed.id]);
      expect(await stateOf(link.id)).toMatchObject({ state: "open", usedBy: null });
      expect(await store.resolveBookingLink(token, now())).toMatchObject({ status: "open" });

      const second = await book(coaching.id, token);
      expect((await stateOf(link.id)).usedBy?.bookingId).toBe(second.id);
      await store.cancelBooking(priya.id, second.id, "guest");
      expect((await stateOf(link.id)).state).toBe("used");
      await expect(book(coaching.id, token)).rejects.toBeInstanceOf(LinkUsedError);
    });

    it("a link for one event type can't book another", async () => {
      const { link, token } = await store.createBookingLink(priya.id, coaching.id, {}, now());
      await expect(book(intro.id, token)).rejects.toMatchObject({ name: "LinkUnavailableError", status: "not_found" });
      expect((await stateOf(link.id)).state).toBe("open");
    });
  });
});

function draftOf(e: EventType): EventTypeDraft {
  return {
    name: e.name, slug: e.slug, description: e.description, durationMinutes: e.durationMinutes, minNoticeMinutes: e.minNoticeMinutes, bookingWindowDays: e.bookingWindowDays,
    startIncrementMinutes: e.startIncrementMinutes, bufferBeforeMinutes: e.bufferBeforeMinutes, bufferAfterMinutes: e.bufferAfterMinutes, dailyLimit: e.dailyLimit, hidden: e.hidden,
    cancelCutoffMinutes: e.cancelCutoffMinutes, priceMinor: e.priceMinor, currency: e.currency, maxRepeats: e.maxRepeats, depositMinor: e.depositMinor, redirectUrl: e.redirectUrl, location: null,
  };
}
