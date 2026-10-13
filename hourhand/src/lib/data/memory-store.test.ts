import { describe, expect, it } from "vitest";
import { computeSlots } from "../slots";
import { createMemoryStore } from "./memory-store";
import { buildSeed } from "./seed";
import { LinkUnavailableError, LinkUsedError, NotFoundError, SlotTakenError } from "./types";

const NOW = new Date("2026-10-10T06:00:00Z");
const guest = { name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: null, answers: [] };

async function setup() {
  const store = createMemoryStore(buildSeed(NOW));
  const host = await store.getCurrentUser();
  const first = (await store.getBooking(host.id, "bkg_1"))!; // confirmed coaching booking
  return { store, host, first };
}

describe("memory store createBooking", () => {
  it("rejects an overlapping booking for the same host with SlotTakenError", async () => {
    const { store, first } = await setup();
    const startAt = new Date(first.startAt.getTime() + 30 * 60_000);
    await expect(store.createBooking({ eventTypeId: "evt_intro", startAt, idempotencyKey: "k1", invitee: guest })).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("returns the existing booking for a repeated idempotency key", async () => {
    const { store, host, first } = await setup();
    const startAt = new Date(first.endAt.getTime() + 3 * 60 * 60_000);
    const input = { eventTypeId: "evt_intro", startAt, idempotencyKey: "same-key", invitee: guest };
    const a = await store.createBooking(input);
    const b = await store.createBooking(input);
    expect(b.id).toBe(a.id);
    expect((await store.listBookings(host.id)).filter((x) => x.idempotencyKey === "same-key")).toHaveLength(1);
  });

  it("a cancelled booking frees its slot", async () => {
    const { store, host, first } = await setup();
    const { schedule, rules } = await store.getDefaultSchedule(host.id);
    const eventType = (await store.getEventType(host.id, "evt_coaching"))!;
    const day = { rangeStart: new Date(first.startAt.getTime() - 3_600_000), rangeEnd: new Date(first.startAt.getTime() + 3_600_000) };
    const slotsNow = async () =>
      computeSlots({ eventType, schedule, rules, busyBlocks: [], bookings: await store.listBookings(host.id), now: NOW, syncStale: false, ...day }).map((d) => d.getTime());

    expect(await slotsNow()).not.toContain(first.startAt.getTime());
    await expect(store.createBooking({ eventTypeId: eventType.id, startAt: first.startAt, idempotencyKey: "k2", invitee: guest })).rejects.toBeInstanceOf(SlotTakenError);

    await store.cancelBooking(host.id, first.id, "guest");
    expect(await slotsNow()).toContain(first.startAt.getTime());
    const rebooked = await store.createBooking({ eventTypeId: eventType.id, startAt: first.startAt, idempotencyKey: "k3", invitee: guest });
    expect(rebooked.status).toBe("confirmed");
  });

  it("does not reuse a question id that belongs to another event type", async () => {
    const { store } = await setup();
    const q = { label: "Anything else?", kind: "short_text" as const, required: false, choices: [] };
    const [saved] = await store.saveQuestions("usr_priya", "evt_intro", [{ ...q, id: "q_goal" }]);
    expect(saved.id).not.toBe("q_goal");
    const coaching = await store.listCustomQuestions("usr_priya", "evt_coaching");
    expect(coaching.map((c) => c.id)).toEqual(["q_goal"]);
    expect(coaching[0].label).toBe("What would you like to work on?");
  });

  it("stores a price with its currency on update, and clears both for a free event", async () => {
    const { store, host } = await setup();
    const draft = {
      name: "Intro", slug: "intro", description: null, durationMinutes: 15, minNoticeMinutes: 240, bookingWindowDays: 60, startIncrementMinutes: 15,
      bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dailyLimit: null, cancelCutoffMinutes: 0, maxRepeats: 1, depositMinor: null, redirectUrl: null, weeklyLimit: null, cancelPolicy: null, seatLimit: null, location: null, hidden: false,
    };
    const priced = await store.updateEventType(host.id, "evt_intro", { ...draft, priceMinor: 49900, currency: "INR" });
    expect([priced.priceMinor, priced.currency]).toEqual([49900, "INR"]);
    expect((await store.getEventType(host.id, "evt_intro"))?.priceMinor).toBe(49900);
    const free = await store.updateEventType(host.id, "evt_intro", { ...draft, priceMinor: null, currency: null });
    expect([free.priceMinor, free.currency]).toEqual([null, null]);
  });

  it("keeps a question id that belongs to the same event type", async () => {
    const { store } = await setup();
    const [saved] = await store.saveQuestions("usr_priya", "evt_coaching", [{ label: "Goal?", kind: "long_text", required: true, choices: [], id: "q_goal" }]);
    expect(saved.id).toBe("q_goal");
  });

  it("seeds Priya's public event types", async () => {
    const { store } = await setup();
    expect((await store.getPublicEventType("priya", "coaching"))?.eventType.durationMinutes).toBe(45);
    expect((await store.getPublicEventType("priya", "intro"))?.eventType.name).toBe("Free 15-min intro call");
  });

  it("refuses another host's records in every method that takes a host id", async () => {
    const { store, host, first } = await setup();
    const stranger = "usr_someone_else";
    const { schedule, rules } = await store.getDefaultSchedule(host.id);
    expect(await store.listCustomQuestions(stranger, "evt_coaching")).toEqual([]);
    expect(await store.listEventLocations(stranger, "evt_coaching")).toEqual([]);
    await expect(store.saveQuestions(stranger, "evt_coaching", [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.cancelBooking(stranger, first.id, "host")).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.rescheduleBooking(stranger, first.id, new Date("2026-10-20T04:00:00Z"), "hijack-1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.saveWeeklyHours(stranger, schedule.id, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.blockDateRange(stranger, schedule.id, "2026-10-20", "2026-10-21")).rejects.toBeInstanceOf(NotFoundError);
    expect((await store.getBooking(host.id, first.id))!.status).toBe("confirmed");
    expect((await store.listCustomQuestions(host.id, "evt_coaching")).length).toBe(1);
    expect((await store.getDefaultSchedule(host.id)).rules).toEqual(rules);
  });

  it("closes an account at once and purges it after 30 days", async () => {
    const { store, host, first } = await setup();
    const cancelled = await store.deleteAccount(host.id, NOW);
    expect(cancelled.map((b) => b.id)).toContain(first.id);
    expect(await store.getUserBySlug("priya")).toBeNull();
    expect(await store.getPublicEventType("priya", "coaching")).toBeNull();
    expect(await store.purgeDeletedAccounts(new Date(NOW.getTime() + 29 * 864e5))).toBe(0);
    expect(await store.purgeDeletedAccounts(new Date(NOW.getTime() + 31 * 864e5))).toBe(1);
    expect(await store.listBookings(host.id)).toEqual([]);
    expect(await store.listEventTypes(host.id)).toEqual([]);
  });
});

describe("memory store single-use booking links", () => {
  it("creates, lists, consumes, resolves and revokes like the Postgres store", async () => {
    const { store, host } = await setup();
    const startAt = new Date(NOW.getTime() + 20 * 24 * 60 * 60_000);
    const { link, token } = await store.createBookingLink(host.id, "evt_intro", { label: "Ravi" }, NOW);
    expect(link).toMatchObject({ eventTypeId: "evt_intro", label: "Ravi", state: "open", usedBy: null });
    expect(await store.resolveBookingLink(token, NOW)).toMatchObject({ status: "open", host: { id: host.id }, eventType: { id: "evt_intro" } });
    expect(await store.resolveBookingLink("nope", NOW)).toEqual({ status: "not_found" });
    await expect(store.createBookingLink("someone-else", "evt_intro", {}, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.createBooking({ eventTypeId: "evt_coaching", startAt, idempotencyKey: "l0", bookingLinkToken: token, invitee: guest }))
      .rejects.toBeInstanceOf(LinkUnavailableError);

    const booking = await store.createBooking({ eventTypeId: "evt_intro", startAt, idempotencyKey: "l1", bookingLinkToken: token, invitee: guest });
    expect((await store.listBookingLinks(host.id, NOW))[0]).toMatchObject({ id: link.id, state: "used", usedBy: { bookingId: booking.id, guestName: guest.name } });
    expect(await store.resolveBookingLink(token, NOW)).toEqual({ status: "used" });
    await expect(store.createBooking({ eventTypeId: "evt_intro", startAt: new Date(startAt.getTime() + 3600_000), idempotencyKey: "l2", bookingLinkToken: token, invitee: guest }))
      .rejects.toBeInstanceOf(LinkUsedError);
    await store.cancelBooking(host.id, booking.id, "guest");
    expect((await store.listBookingLinks(host.id, NOW))[0].state).toBe("used");

    const other = await store.createBookingLink(host.id, "evt_coaching", { expiresAt: new Date(NOW.getTime() + 60_000) }, NOW);
    expect((await store.listBookingLinks(host.id, NOW)).map((l) => l.id)).toEqual([other.link.id, link.id]);
    expect(await store.resolveBookingLink(other.token, new Date(NOW.getTime() + 120_000))).toEqual({ status: "expired" });
    await expect(store.revokeBookingLink("someone-else", other.link.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
    expect(await store.revokeBookingLink(host.id, other.link.id, NOW)).toMatchObject({ state: "revoked", revokedAt: NOW });
    expect(await store.resolveBookingLink(other.token, NOW)).toEqual({ status: "revoked" });
  });
});

