import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./memory-store";
import { InvalidOneOffError, type OneOffInput } from "./types";

const now = new Date("2030-06-01T00:00:00Z");
const at = (iso: string) => new Date(iso);
const meeting = (times: Date[]): OneOffInput => ({ name: "Contract review", durationMinutes: 30, location: { kind: "google_meet" }, times });
const invitee = { name: "Asha", email: "asha@example.com", timezone: "Asia/Kolkata", phone: null, answers: [] };

describe("one-off meetings (memory store)", () => {
  it("refuses no times, more than 20, a past time and a repeated time", async () => {
    const store = createMemoryStore();
    const host = await store.getCurrentUser();
    const many = Array.from({ length: 21 }, (_, i) => new Date(now.getTime() + (i + 1) * 3_600_000));
    for (const times of [[], many, [at("2030-05-31T10:00:00Z")], [at("2030-06-02T10:00:00Z"), at("2030-06-02T10:00:00Z")]]) {
      await expect(store.createOneOffMeeting(host.id, meeting(times), now)).rejects.toBeInstanceOf(InvalidOneOffError);
    }
    await expect(store.createOneOffMeeting(host.id, { ...meeting([at("2030-06-02T10:00:00Z")]), durationMinutes: 721 }, now)).rejects.toBeInstanceOf(InvalidOneOffError);
  });

  it("stores a hidden one_off type with its times and an open link expiring at the last time", async () => {
    const store = createMemoryStore();
    const host = await store.getCurrentUser();
    const { eventType, link, token } = await store.createOneOffMeeting(host.id, meeting([at("2030-06-03T10:00:00Z"), at("2030-06-02T10:00:00Z")]), now);
    expect(eventType).toMatchObject({ kind: "one_off", hidden: true, minNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(eventType.slug).toMatch(/^one-off-[a-z0-9]{8}$/);
    expect(await store.listOneOffTimes(eventType.id)).toEqual([at("2030-06-02T10:00:00Z"), at("2030-06-03T10:00:00Z")]);
    expect(link).toMatchObject({ state: "open", expiresAt: at("2030-06-03T10:00:00Z") });
    expect((await store.resolveBookingLink(token, now)).status).toBe("open");
  });

  it("is left off the event types list and can't be found by slug", async () => {
    const store = createMemoryStore();
    const host = await store.getCurrentUser();
    const { eventType } = await store.createOneOffMeeting(host.id, meeting([at("2030-06-02T10:00:00Z")]), now);
    expect((await store.listEventTypes(host.id)).map((e) => e.id)).not.toContain(eventType.id);
    expect(await store.getPublicEventType(host.slug, eventType.slug)).toBeNull();
  });

  it("keeps the booking's link when it is rescheduled", async () => {
    const store = createMemoryStore();
    const host = await store.getCurrentUser();
    const { eventType, token } = await store.createOneOffMeeting(host.id, meeting([at("2030-06-02T10:00:00Z"), at("2030-06-03T10:00:00Z")]), now);
    const booked = await store.createBooking({ eventTypeId: eventType.id, startAt: at("2030-06-02T10:00:00Z"), idempotencyKey: "oneoff-book-1", bookingLinkToken: token, invitee });
    const moved = await store.rescheduleBooking(host.id, booked.id, at("2030-06-03T10:00:00Z"), "oneoff-move-1");
    const [link] = await store.listBookingLinks(host.id, now);
    expect(link.usedBy).toMatchObject({ bookingId: moved.id, startAt: at("2030-06-03T10:00:00Z") });
  });
});
