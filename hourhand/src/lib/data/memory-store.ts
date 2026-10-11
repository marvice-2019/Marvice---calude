import { randomUUID } from "node:crypto";
import { datesInRange } from "../availability";
import { overlaps } from "../slots";
import { buildSeed, type Seed } from "./seed";
import { hashLinkToken, newLinkToken } from "../links";
import { checkOneOff, oneOffSlug } from "./one-off";
import {
  EventTypeInUseError, LinkUnavailableError, LinkUsedError, NotFoundError, RequestKeyConflictError, SlotTakenError, SlugTakenError, type BookingLink, type BookingWithInvitee,
  type CreateBookingInput, type DataStore, type EventType, type EventTypeDraft, type Interval,
} from "./types";

const MIN = 60_000;

/** In-memory stand-in for the Postgres store. The "current user" is the first seeded user until auth lands. */
export function createMemoryStore(seed: Seed = buildSeed(new Date())): DataStore {
  const db = structuredClone(seed);
  const deleted = new Map<string, Date>(); // user id -> when the account was closed
  const host = db.users[0];
  type LinkRow = { id: string; userId: string; eventTypeId: string; tokenHash: string; label: string | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date };
  const links: LinkRow[] = []; // newest last
  const linkOfBooking = new Map<string, string>(); // booking id -> booking link id (bookings.booking_link_id)
  const oneOffTimes = new Map<string, Date[]>(); // one_off event type id -> offered start times, earliest first

  /** Same derived rule as Postgres: used when a booking made through it exists that the system didn't cancel. */
  function toLink(row: LinkRow, now: Date): BookingLink {
    const used = db.bookings.filter((b) => linkOfBooking.get(b.id) === row.id && !(b.status === "cancelled" && b.cancelledBy === "system")).at(-1);
    const usedBy = used ? { bookingId: used.id, guestName: used.invitee.name, startAt: used.startAt } : null;
    const state = usedBy ? "used" : row.revokedAt ? "revoked" : row.expiresAt && row.expiresAt.getTime() <= now.getTime() ? "expired" : "open";
    return { id: row.id, eventTypeId: row.eventTypeId, label: row.label, expiresAt: row.expiresAt, revokedAt: row.revokedAt, createdAt: row.createdAt, state, usedBy };
  }

  /** Checks the link is open and for this event type. Synchronous with the insert that follows, so no race. */
  function openLink(token: string, eventTypeId: string): LinkRow {
    const row = links.find((l) => l.tokenHash === hashLinkToken(token));
    if (!row || row.eventTypeId !== eventTypeId) throw new LinkUnavailableError("not_found");
    const { state } = toLink(row, new Date());
    if (state === "used") throw new LinkUsedError();
    if (state !== "open") throw new LinkUnavailableError(state);
    return row;
  }

  /** Builds a confirmed booking after the overlap check. `movingId` is the booking being rescheduled, which the check skips. */
  function build(input: CreateBookingInput, movingId: string | null): BookingWithInvitee {
    // Paid bookings need Razorpay and the payments table: Postgres only.
    if (input.holdUntil) throw new Error("Paid bookings (holdUntil) need the Postgres store");
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
      id, eventTypeId: et.id, hostId: et.userId, startAt, endAt, bufferedStart, bufferedEnd, status: "confirmed", holdExpiresAt: null,
      locationKind: db.locations.find((l) => l.eventTypeId === et.id)?.kind ?? null, joinUrl: null,
      idempotencyKey: input.idempotencyKey, cancelledAt: null, cancelledBy: null, cancelReason: null, rescheduledFromId: movingId, createdAt: new Date(),
      invitee: { id: randomUUID(), bookingId: id, hostId: et.userId, ...input.invitee, manageToken: randomUUID().replaceAll("-", ""), noShowAt: null },
    };
  }

  function owned(userId: string, id: string): EventType {
    const eventType = db.eventTypes.find((e) => e.userId === userId && e.id === id);
    if (!eventType) throw new NotFoundError("Event type");
    return eventType;
  }

  /** Same rule as unique (user_id, slug). */
  function assertSlugFree(userId: string, slug: string, exceptId: string | null) {
    if (db.eventTypes.some((e) => e.userId === userId && e.slug === slug && e.id !== exceptId)) throw new SlugTakenError();
  }

  function fields(draft: EventTypeDraft): Omit<EventTypeDraft, "location"> {
    const { name, slug, description, durationMinutes, minNoticeMinutes, bookingWindowDays, startIncrementMinutes, bufferBeforeMinutes, bufferAfterMinutes, dailyLimit, cancelCutoffMinutes, priceMinor, currency } = draft;
    return {
      name, slug, description, durationMinutes, minNoticeMinutes, bookingWindowDays, startIncrementMinutes, bufferBeforeMinutes, bufferAfterMinutes, dailyLimit, cancelCutoffMinutes,
      priceMinor, currency: priceMinor === null ? null : currency,
    };
  }

  function setLocation(eventTypeId: string, draft: EventTypeDraft) {
    db.locations = db.locations.filter((l) => l.eventTypeId !== eventTypeId);
    if (draft.location) db.locations.push({ id: randomUUID(), eventTypeId, ...draft.location, position: 0 });
  }

  return {
    deleteAccount,
    purgeDeletedAccounts,
    async getCurrentUser() {
      return host;
    },
    async getUser(id) {
      return db.users.find((u) => u.id === id && !deleted.has(u.id)) ?? null;
    },
    async getUserBySlug(slug) {
      return db.users.find((u) => u.slug === slug && !deleted.has(u.id)) ?? null;
    },
    async listEventTypes(userId) {
      // One-off meetings live on the Links page, not in the event types list.
      return db.eventTypes.filter((e) => e.userId === userId && e.kind !== "one_off").sort((a, b) => a.position - b.position);
    },
    async getEventType(userId, id) {
      return db.eventTypes.find((e) => e.userId === userId && e.id === id) ?? null;
    },
    async getPublicEventType(hostSlug, eventSlug) {
      const user = db.users.find((u) => u.slug === hostSlug && !deleted.has(u.id));
      const eventType = user && db.eventTypes.find((e) => e.userId === user.id && e.slug === eventSlug && e.active && e.kind !== "one_off");
      return user && eventType ? { host: user, eventType } : null;
    },
    async listEventLocations(userId, eventTypeId) {
      if (!ownsEventType(userId, eventTypeId)) return [];
      return db.locations.filter((l) => l.eventTypeId === eventTypeId);
    },
    async listCustomQuestions(userId, eventTypeId) {
      if (!ownsEventType(userId, eventTypeId)) return [];
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
      if (repeat) {
        if (repeat.eventTypeId === input.eventTypeId && repeat.rescheduledFromId === null) return repeat;
        throw new RequestKeyConflictError();
      }
      const link = input.bookingLinkToken === undefined ? null : openLink(input.bookingLinkToken, input.eventTypeId);
      const booking = build(input, null);
      db.bookings.push(booking);
      if (link) linkOfBooking.set(booking.id, link.id);
      return booking;
    },
    async createBookingLink(hostId, eventTypeId, opts, now) {
      if (!owned(hostId, eventTypeId).active) throw new NotFoundError("Event type");
      const token = newLinkToken();
      const row: LinkRow = { id: randomUUID(), userId: hostId, eventTypeId, tokenHash: hashLinkToken(token), label: opts.label ?? null, expiresAt: opts.expiresAt ?? null, revokedAt: null, createdAt: new Date() };
      links.push(row);
      return { link: toLink(row, now), token };
    },
    async listBookingLinks(hostId, now) {
      return links.filter((l) => l.userId === hostId).reverse().map((l) => toLink(l, now));
    },
    async revokeBookingLink(hostId, linkId, now) {
      const row = links.find((l) => l.userId === hostId && l.id === linkId);
      if (!row || toLink(row, now).state !== "open") throw new NotFoundError("Booking link");
      row.revokedAt = now;
      return toLink(row, now);
    },
    async resolveBookingLink(token, now) {
      const row = links.find((l) => l.tokenHash === hashLinkToken(token));
      if (!row) return { status: "not_found" };
      const link = toLink(row, now);
      if (link.state !== "open") return { status: link.state };
      const linkHost = deleted.has(row.userId) ? undefined : db.users.find((u) => u.id === row.userId);
      const eventType = db.eventTypes.find((e) => e.id === row.eventTypeId && e.active);
      if (!linkHost || !eventType) return { status: "not_found" };
      return { status: "open", link, host: linkHost, eventType };
    },
    async createOneOffMeeting(hostId, input, now) {
      const times = checkOneOff(input, now);
      const eventType: EventType = {
        id: randomUUID(), userId: hostId, scheduleId: db.schedules.find((s) => s.userId === hostId && s.isDefault)?.id ?? null,
        name: input.name.trim(), slug: oneOffSlug(), description: input.description ?? null, durationMinutes: input.durationMinutes,
        minNoticeMinutes: 0, bookingWindowDays: 730, startIncrementMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dailyLimit: null,
        cancelCutoffMinutes: 0, priceMinor: null, currency: null, hidden: true, active: true, position: 0, kind: "one_off",
      };
      db.eventTypes.push(eventType);
      db.locations.push({ id: randomUUID(), eventTypeId: eventType.id, kind: input.location.kind, value: input.location.value ?? null, position: 0 });
      oneOffTimes.set(eventType.id, times);
      const { link, token } = await this.createBookingLink(hostId, eventType.id, { expiresAt: times[times.length - 1] }, now);
      return { eventType, link, token };
    },
    async listOneOffTimes(eventTypeId) {
      return [...(oneOffTimes.get(eventTypeId) ?? [])];
    },
    async rescheduleBooking(hostId, bookingId, startAt, idempotencyKey, by = "guest") {
      const repeat = db.bookings.find((b) => b.idempotencyKey === idempotencyKey);
      if (repeat) {
        if (repeat.hostId === hostId && repeat.rescheduledFromId === bookingId) return repeat;
        throw new RequestKeyConflictError();
      }
      const old = db.bookings.find((b) => b.hostId === hostId && b.id === bookingId);
      if (!old) throw new NotFoundError("Booking");
      const { name, email, timezone, phone, answers } = old.invitee;
      // Both steps run synchronously, so no other request can see the half-done state (one transaction in Postgres).
      const booking = build({ eventTypeId: old.eventTypeId, startAt, idempotencyKey, invitee: { name, email, timezone, phone, answers: answers.map((a) => ({ ...a })) } }, old.id);
      db.bookings.push(booking);
      // The move keeps the booking's single-use link, so the link shows the current time.
      const linkId = linkOfBooking.get(old.id);
      if (linkId) linkOfBooking.set(booking.id, linkId);
      Object.assign(old, { status: "cancelled", cancelledAt: new Date(), cancelledBy: by, cancelReason: "Rescheduled" });
      return booking;
    },
    async cancelBooking(hostId, bookingId, by, reason) {
      const booking = db.bookings.find((b) => b.hostId === hostId && b.id === bookingId);
      if (!booking) throw new NotFoundError("Booking");
      if (booking.status === "confirmed") {
        Object.assign(booking, { status: "cancelled", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason ?? null });
      }
      return booking;
    },
    async setNoShow(hostId, bookingId, on, now) {
      const booking = db.bookings.find((b) => b.hostId === hostId && b.id === bookingId && b.status === "confirmed" && b.startAt.getTime() <= now.getTime());
      if (!booking) throw new NotFoundError("Booking");
      booking.invitee.noShowAt = on ? now : null;
      return booking;
    },
    async saveWeeklyHours(userId, scheduleId, byWeekday) {
      ownedSchedule(userId, scheduleId);
      db.rules = db.rules.filter((r) => !(r.scheduleId === scheduleId && r.kind === "weekly"));
      for (const [day, intervals] of Object.entries(byWeekday)) {
        if (intervals.length === 0) continue;
        db.rules.push({ id: randomUUID(), scheduleId, kind: "weekly", weekday: Number(day), onDate: null, intervals: intervals.map((i) => ({ ...i })) });
      }
    },
    async saveDateOverride(userId, scheduleId, date, intervals) {
      ownedSchedule(userId, scheduleId);
      setOverride(scheduleId, date, intervals);
    },
    async deleteDateOverride(userId, scheduleId, date) {
      ownedSchedule(userId, scheduleId);
      db.rules = db.rules.filter((r) => !(r.scheduleId === scheduleId && r.kind === "date" && r.onDate === date));
    },
    async blockDateRange(userId, scheduleId, from, to) {
      ownedSchedule(userId, scheduleId);
      for (const date of datesInRange(from, to)) setOverride(scheduleId, date, []);
    },
    async createEventType(userId, draft) {
      assertSlugFree(userId, draft.slug, null);
      const mine = db.eventTypes.filter((e) => e.userId === userId);
      const eventType: EventType = {
        id: randomUUID(), userId, scheduleId: db.schedules.find((s) => s.userId === userId && s.isDefault)?.id ?? null,
        ...fields(draft), hidden: false, active: true, position: Math.max(-1, ...mine.map((e) => e.position)) + 1, kind: "one_on_one",
      };
      db.eventTypes.push(eventType);
      setLocation(eventType.id, draft);
      return eventType;
    },
    async updateEventType(userId, id, draft) {
      const eventType = owned(userId, id);
      assertSlugFree(userId, draft.slug, id);
      Object.assign(eventType, fields(draft));
      setLocation(id, draft);
      return eventType;
    },
    async setEventTypeActive(userId, id, active) {
      return Object.assign(owned(userId, id), { active });
    },
    async deleteEventType(userId, id, now = new Date()) {
      owned(userId, id);
      const used = db.bookings.filter((b) => b.eventTypeId === id);
      const upcoming = used.filter((b) => b.status === "confirmed" && b.startAt.getTime() > now.getTime()).length;
      if (upcoming > 0) throw new EventTypeInUseError("upcoming", upcoming);
      if (used.length > 0) throw new EventTypeInUseError("history", 0);
      db.eventTypes = db.eventTypes.filter((e) => e.id !== id);
      db.locations = db.locations.filter((l) => l.eventTypeId !== id);
      db.questions = db.questions.filter((q) => q.eventTypeId !== id);
    },
    async saveQuestions(userId, eventTypeId, questions) {
      if (!ownsEventType(userId, eventTypeId)) throw new NotFoundError("Event type");
      // Keep a client-sent id only when it already belongs to a question of this event type.
      const own = new Set(db.questions.filter((q) => q.eventTypeId === eventTypeId).map((q) => q.id));
      const saved = questions.map((q, position) => ({
        id: q.id !== null && own.has(q.id) ? q.id : randomUUID(), eventTypeId, label: q.label, kind: q.kind, required: q.required, choices: [...q.choices], position,
      }));
      db.questions = [...db.questions.filter((q) => q.eventTypeId !== eventTypeId), ...saved];
      return saved;
    },
  };

  async function deleteAccount(userId: string, now = new Date()) {
    deleted.set(userId, now);
    for (const e of db.eventTypes) if (e.userId === userId) e.active = false;
    const upcoming = db.bookings.filter((b) => b.hostId === userId && b.status === "confirmed" && b.startAt.getTime() > now.getTime());
    for (const b of upcoming) Object.assign(b, { status: "cancelled", cancelledAt: now, cancelledBy: "host", cancelReason: "The host closed their account" });
    return upcoming;
  }

  async function purgeDeletedAccounts(now = new Date()) {
    const cutoff = now.getTime() - 30 * 24 * 60 * MIN;
    const gone = new Set([...deleted].filter(([, at]) => at.getTime() < cutoff).map(([id]) => id));
    const types = new Set(db.eventTypes.filter((e) => gone.has(e.userId)).map((e) => e.id));
    const schedules = new Set(db.schedules.filter((sc) => gone.has(sc.userId)).map((sc) => sc.id));
    db.users = db.users.filter((u) => !gone.has(u.id));
    db.eventTypes = db.eventTypes.filter((e) => !gone.has(e.userId));
    db.locations = db.locations.filter((l) => !types.has(l.eventTypeId));
    db.questions = db.questions.filter((q) => !types.has(q.eventTypeId));
    db.schedules = db.schedules.filter((sc) => !gone.has(sc.userId));
    db.rules = db.rules.filter((r) => !schedules.has(r.scheduleId));
    db.bookings = db.bookings.filter((b) => !gone.has(b.hostId));
    db.connections = db.connections.filter((c) => !gone.has(c.userId));
    db.calendars = db.calendars.filter((c) => !gone.has(c.userId));
    db.busyBlocks = db.busyBlocks.filter((b) => !gone.has(b.userId));
    for (const id of gone) deleted.delete(id);
    return gone.size;
  }

  function ownsEventType(userId: string, eventTypeId: string): boolean {
    return db.eventTypes.some((e) => e.userId === userId && e.id === eventTypeId);
  }

  function ownedSchedule(userId: string, scheduleId: string) {
    if (!db.schedules.some((sc) => sc.userId === userId && sc.id === scheduleId)) throw new NotFoundError("Schedule");
  }

  function setOverride(scheduleId: string, date: string, intervals: Interval[]) {
    db.rules = db.rules.filter((r) => !(r.scheduleId === scheduleId && r.kind === "date" && r.onDate === date));
    db.rules.push({ id: randomUUID(), scheduleId, kind: "date", weekday: null, onDate: date, intervals: intervals.map((i) => ({ ...i })) });
  }
}
