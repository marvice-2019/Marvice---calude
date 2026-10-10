import { randomUUID } from "node:crypto";
import { overlaps } from "../slots";
import { buildSeed, type Seed } from "./seed";
import { SlotTakenError, type BookingWithInvitee, type CreateBookingInput, type DataStore } from "./types";

const MIN = 60_000;

/** In-memory stand-in for the Postgres store. The "current user" is the first seeded user until auth lands. */
export function createMemoryStore(seed: Seed = buildSeed(new Date())): DataStore {
  const db = structuredClone(seed);
  const host = db.users[0];

  return {
    async getCurrentUser() {
      return host;
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
      const et = db.eventTypes.find((e) => e.id === input.eventTypeId);
      if (!et) throw new Error(`Unknown event type ${input.eventTypeId}`);

      const startAt = input.startAt;
      const endAt = new Date(startAt.getTime() + et.durationMinutes * MIN);
      const bufferedStart = new Date(startAt.getTime() - et.bufferBeforeMinutes * MIN);
      const bufferedEnd = new Date(endAt.getTime() + et.bufferAfterMinutes * MIN);
      // Same rule as the exclusion constraint: no two confirmed bookings of one host overlap, buffers included.
      const clash = db.bookings.some(
        (b) => b.hostId === et.userId && b.status === "confirmed" &&
          overlaps(bufferedStart.getTime(), bufferedEnd.getTime(), b.bufferedStart.getTime(), b.bufferedEnd.getTime()),
      );
      if (clash) throw new SlotTakenError();

      const id = randomUUID();
      const booking: BookingWithInvitee = {
        id, eventTypeId: et.id, hostId: et.userId, startAt, endAt, bufferedStart, bufferedEnd, status: "confirmed",
        locationKind: db.locations.find((l) => l.eventTypeId === et.id)?.kind ?? null,
        idempotencyKey: input.idempotencyKey, cancelledAt: null, cancelledBy: null, cancelReason: null, createdAt: new Date(),
        invitee: { id: randomUUID(), bookingId: id, hostId: et.userId, ...input.invitee, manageToken: randomUUID().replaceAll("-", "") },
      };
      db.bookings.push(booking);
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
  };
}
