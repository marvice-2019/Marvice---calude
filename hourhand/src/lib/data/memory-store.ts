import { randomUUID } from "node:crypto";
import { datesInRange } from "../availability";
import { overlaps } from "../slots";
import { buildSeed, type Seed } from "./seed";
import { SlotTakenError, type BookingWithInvitee, type CreateBookingInput, type DataStore, type Interval } from "./types";

const MIN = 60_000;

/** In-memory stand-in for the Postgres store. The "current user" is the first seeded user until auth lands. */
export function createMemoryStore(seed: Seed = buildSeed(new Date())): DataStore {
  const db = structuredClone(seed);
  const host = db.users[0];

  /** Builds a confirmed booking after the overlap check. `movingId` is the booking being rescheduled, which the check skips. */
  function build(input: CreateBookingInput, movingId: string | null): BookingWithInvitee {
    const et = db.eventTypes.find((e) => e.id === input.eventTypeId);
    if (!et) throw new Error(`Unknown event type ${input.eventTypeId}`);

    const startAt = input.startAt;
    const endAt = new Date(startAt.getTime() + et.durationMinutes * MIN);
    const bufferedStart = new Date(startAt.getTime() - et.bufferBeforeMinutes * MIN);
    const bufferedEnd = new Date(endAt.getTime() + et.bufferAfterMinutes * MIN);
    // Same rule as the exclusion constraint: no two confirmed bookings of one host overlap, buffers included.
    const clash = db.bookings.some(
      (b) => b.hostId === et.userId && b.status === "confirmed" && b.id !== movingId &&
        overlaps(bufferedStart.getTime(), bufferedEnd.getTime(), b.bufferedStart.getTime(), b.bufferedEnd.getTime()),
    );
    if (clash) throw new SlotTakenError();

    const id = randomUUID();
    return {
      id, eventTypeId: et.id, hostId: et.userId, startAt, endAt, bufferedStart, bufferedEnd, status: "confirmed",
      locationKind: db.locations.find((l) => l.eventTypeId === et.id)?.kind ?? null,
      idempotencyKey: input.idempotencyKey, cancelledAt: null, cancelledBy: null, cancelReason: null, rescheduledFromId: movingId, createdAt: new Date(),
      invitee: { id: randomUUID(), bookingId: id, hostId: et.userId, ...input.invitee, manageToken: randomUUID().replaceAll("-", "") },
    };
  }

  return {
    async getCurrentUser() {
      return host;
    },
    async getUser(id) {
      return db.users.find((u) => u.id === id) ?? null;
    },
    async getUserBySlug(slug) {
      return db.users.find((u) => u.slug === slug) ?? null;
    },
    async listEventTypes(userId) {
      return db.eventTypes.filter((e) => e.userId === userId).sort((a, b) => a.position - b.position);
    },
    async getEventType(userId, id) {
      return db.eventTypes.find((e) => e.userId === userId && e.id === id) ?? null;
    },
    async getPublicEventType(hostSlug, eventSlug) {
      const user = db.users.find((u) => u.slug === hostSlug);
      const eventType = user && db.eventTypes.find((e) => e.userId === user.id && e.slug === eventSlug && e.active);
      return user && eventType ? { host: user, eventType } : null;
    },
    async listEventLocations(eventTypeId) {
      return db.locations.filter((l) => l.eventTypeId === eventTypeId);
    },
    async listCustomQuestions(eventTypeId) {
      return db.questions.filter((q) => q.eventTypeId === eventTypeId);
    },
    async getDefaultSchedule(userId) {
      const schedule = db.schedules.find((s) => s.userId === userId && s.isDefault);
      if (!schedule) throw new Error(`No default schedule for ${userId}`);
      return { schedule, rules: db.rules.filter((r) => r.scheduleId === schedule.id) };
    },
    async listCalendarConnections(userId) {
      return db.connections.filter((c) => c.userId === userId);
    },
    async listCalendars(userId) {
      return db.calendars.filter((c) => c.userId === userId);
    },
    async listBusyBlocks(userId, from, to) {
      return db.busyBlocks.filter((b) => b.userId === userId && overlaps(b.start.getTime(), b.end.getTime(), from.getTime(), to.getTime()));
    },
    async listBookings(userId) {
      return db.bookings.filter((b) => b.hostId === userId).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    },
    async getBooking(userId, id) {
      return db.bookings.find((b) => b.hostId === userId && b.id === id) ?? null;
    },
    async getBookingByManageToken(token) {
      return db.bookings.find((b) => b.invitee.manageToken === token) ?? null;
    },
    async createBooking(input: CreateBookingInput) {
      const repeat = db.bookings.find((b) => b.idempotencyKey === input.idempotencyKey);
      if (repeat) return repeat;
      const booking = build(input, null);
      db.bookings.push(booking);
      return booking;
    },
    async rescheduleBooking(bookingId, startAt, idempotencyKey) {
      const repeat = db.bookings.find((b) => b.idempotencyKey === idempotencyKey);
      if (repeat) return repeat;
      const old = db.bookings.find((b) => b.id === bookingId);
      if (!old) throw new Error(`Unknown booking ${bookingId}`);
      const { name, email, timezone, phone, answers } = old.invitee;
      // Both steps run synchronously, so no other request can see the half-done state (one transaction in Postgres).
      const booking = build({ eventTypeId: old.eventTypeId, startAt, idempotencyKey, invitee: { name, email, timezone, phone, answers: answers.map((a) => ({ ...a })) } }, old.id);
      db.bookings.push(booking);
      Object.assign(old, { status: "cancelled", cancelledAt: new Date(), cancelledBy: "guest", cancelReason: "Rescheduled" });
      return booking;
    },
    async cancelBooking(bookingId, by, reason) {
      const booking = db.bookings.find((b) => b.id === bookingId);
      if (!booking) throw new Error(`Unknown booking ${bookingId}`);
      if (booking.status === "confirmed") {
        Object.assign(booking, { status: "cancelled", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason ?? null });
      }
      return booking;
    },
    async saveWeeklyHours(scheduleId, byWeekday) {
      db.rules = db.rules.filter((r) => !(r.scheduleId === scheduleId && r.kind === "weekly"));
      for (const [day, intervals] of Object.entries(byWeekday)) {
        if (intervals.length === 0) continue;
        db.rules.push({ id: randomUUID(), scheduleId, kind: "weekly", weekday: Number(day), onDate: null, intervals: intervals.map((i) => ({ ...i })) });
      }
    },
    async saveDateOverride(scheduleId, date, intervals) {
      setOverride(scheduleId, date, intervals);
    },
    async deleteDateOverride(scheduleId, date) {
      db.rules = db.rules.filter((r) => !(r.scheduleId === scheduleId && r.kind === "date" && r.onDate === date));
    },
    async blockDateRange(scheduleId, from, to) {
      for (const date of datesInRange(from, to)) setOverride(scheduleId, date, []);
    },
  };

  function setOverride(scheduleId: string, date: string, intervals: Interval[]) {
    db.rules = db.rules.filter((r) => !(r.scheduleId === scheduleId && r.kind === "date" && r.onDate === date));
    db.rules.push({ id: randomUUID(), scheduleId, kind: "date", weekday: null, onDate: date, intervals: intervals.map((i) => ({ ...i })) });
  }
}
