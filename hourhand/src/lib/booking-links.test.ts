import { describe, expect, it } from "vitest";
import { handleCreateBooking, handleGetSlots } from "./booking";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import { computeOneOffSlots } from "./slots";

const now = new Date("2026-10-10T04:00:00Z");
const DAY = 86_400_000;
const MIN = 60_000;
const fresh = () => createMemoryStore(buildSeed(now));
const range = { from: now.toISOString(), to: new Date(now.getTime() + 30 * DAY).toISOString(), tz: "Asia/Kolkata" };

const slotsVia = async (store: ReturnType<typeof fresh>, params: Record<string, string>) =>
  handleGetSlots(store, new URLSearchParams({ ...range, ...params }), now);
const bookVia = (store: ReturnType<typeof fresh>, start: string, extra: Record<string, unknown>, key: string) =>
  handleCreateBooking(store, {
    start, name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", answers: { q_goal: "Planning a career move." }, idempotencyKey: key, ...extra,
  }, now);
const slotList = (res: { body: unknown }) => (res.body as { slots: string[] }).slots;

describe("computeOneOffSlots", () => {
  const t = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const base = { durationMinutes: 30, busyBlocks: [], bookings: [], now, rangeStart: now, rangeEnd: new Date(now.getTime() + 30 * DAY), syncStale: false };
  const booking = (start: Date, status: "confirmed" | "cancelled" | "pending_payment", holdExpiresAt: Date | null = null) => ({
    eventTypeId: "x", status, holdExpiresAt, startAt: start, bufferedStart: start, bufferedEnd: new Date(start.getTime() + 30 * MIN),
  });

  it("offers only future offered times that clash with nothing, soonest first", () => {
    const slots = computeOneOffSlots({
      ...base,
      times: [t(5), t(-1), t(2), t(3), t(4), t(6)],
      busyBlocks: [{ start: t(3), end: new Date(t(3).getTime() + 10 * MIN) }],
      bookings: [booking(t(4), "confirmed"), booking(t(5), "pending_payment", t(1)), booking(t(6), "pending_payment", new Date(now.getTime() - MIN))],
    });
    // -1h is past, 3h is busy, 4h is booked, 5h is held by a live payment; 6h's hold has lapsed so it's free again.
    expect(slots).toEqual([t(2), t(6)]);
  });

  it("offers nothing while a calendar is out of date, and nothing outside the range", () => {
    expect(computeOneOffSlots({ ...base, times: [t(2)], syncStale: true })).toEqual([]);
    expect(computeOneOffSlots({ ...base, times: [t(2)], rangeEnd: t(1) })).toEqual([]);
  });
});

describe("single-use links through the public handlers", () => {
  it("lists times and books through an open link once; a second booking and its times are refused as used", async () => {
    const store = fresh();
    const { token } = await store.createBookingLink("usr_priya", "evt_coaching", {}, now);
    const slots = slotList(await slotsVia(store, { link: token }));
    expect(slots.length).toBeGreaterThan(2);
    const first = await bookVia(store, slots[0], { linkToken: token }, "link-key-0001");
    expect(first.status).toBe(201);
    const again = await bookVia(store, slots[1], { linkToken: token }, "link-key-0002");
    expect(again).toMatchObject({ status: 409, body: { error: "link_used" } });
    expect(await slotsVia(store, { link: token })).toMatchObject({ status: 409, body: { error: "link_used" } });
    const [link] = await store.listBookingLinks("usr_priya", now);
    expect(link.state).toBe("used");
  });

  it("refuses revoked, expired and unknown links without saying whose they are", async () => {
    const store = fresh();
    const revoked = await store.createBookingLink("usr_priya", "evt_coaching", {}, now);
    await store.revokeBookingLink("usr_priya", revoked.link.id, now);
    const expired = await store.createBookingLink("usr_priya", "evt_coaching", { expiresAt: new Date(now.getTime() - MIN) }, now);
    for (const [token, status, code] of [[revoked.token, 410, "link_revoked"], [expired.token, 410, "link_expired"], ["no-such-token-at-all", 404, "link_not_found"]] as const) {
      const s = await slotsVia(store, { link: token });
      expect(s).toEqual({ status, body: { error: code } });
      const b = await bookVia(store, new Date(now.getTime() + 2 * DAY).toISOString(), { linkToken: token }, `key-${code}`);
      expect(b).toEqual({ status, body: { error: code } });
    }
  });

  it("a one-off meeting offers exactly its times through its link, and can't be reached by its slug", async () => {
    const store = fresh();
    const times = [new Date("2026-10-20T03:00:00Z"), new Date("2026-10-21T03:30:00Z")];
    const { eventType, token } = await store.createOneOffMeeting("usr_priya",
      { name: "Contract review", durationMinutes: 30, location: { kind: "google_meet" }, times }, now);
    expect(slotList(await slotsVia(store, { link: token }))).toEqual(times.map((d) => d.toISOString()));
    expect(await slotsVia(store, { slug: "priya", event: eventType.slug })).toMatchObject({ status: 404 });
    expect(await bookVia(store, times[0].toISOString(), { slug: "priya", event: eventType.slug }, "oneoff-by-slug")).toMatchObject({ status: 404 });
    // An off-list time is refused like any time the engine doesn't offer.
    expect(await bookVia(store, new Date("2026-10-20T04:00:00Z").toISOString(), { linkToken: token }, "oneoff-off-list")).toMatchObject({ status: 409, body: { error: "slot_taken" } });
    const ok = await bookVia(store, times[1].toISOString(), { linkToken: token }, "oneoff-ok-0001");
    expect(ok.status).toBe(201);
    expect(await slotsVia(store, { link: token })).toMatchObject({ status: 409, body: { error: "link_used" } });
  });
});
