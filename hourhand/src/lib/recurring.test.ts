import { describe, expect, it } from "vitest";
import { handleCreateBooking, handleGetSlots } from "./booking";
import { handleCancel, handleReschedule } from "./manage";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import { validateEventType, NEW_EVENT_TYPE_FORM } from "./event-types";

const now = new Date("2026-10-10T04:00:00Z");
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** The demo data with coaching open to weekly repeats of up to `max` weeks. */
function fresh(max = 4) {
  const seed = buildSeed(now);
  seed.eventTypes.find((e) => e.id === "evt_coaching")!.maxRepeats = max;
  return createMemoryStore(seed);
}
/** The first time that is open four weeks running, so a series of up to four weeks fits. */
const firstSlot = async (store: ReturnType<typeof fresh>) => {
  const res = await handleGetSlots(store, new URLSearchParams({ slug: "priya", event: "coaching", from: now.toISOString(), to: new Date(now.getTime() + 50 * DAY).toISOString(), tz: "Asia/Kolkata" }), now);
  const slots = (res.body as { slots: string[] }).slots;
  const open = new Set(slots.map((s) => new Date(s).getTime()));
  return slots.find((s) => [1, 2, 3].every((w) => open.has(new Date(s).getTime() + w * WEEK)))!;
};
const book = (store: ReturnType<typeof fresh>, start: string, extra: Record<string, unknown>, key = `series-${Math.random()}`) =>
  handleCreateBooking(store, {
    slug: "priya", event: "coaching", start, name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", answers: { q_goal: "Weekly practice." }, idempotencyKey: key, ...extra,
  }, now);

describe("weekly repeats", () => {
  it("books the same time every week, all in one series, and returns the first week", async () => {
    const store = fresh();
    const start = await firstSlot(store);
    const res = await book(store, start, { weeks: 3 }, "series-key-001");
    expect(res).toMatchObject({ status: 201 });
    const series = (await store.listBookings("usr_priya")).filter((b) => b.idempotencyKey.startsWith("series-key-001")).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    expect(series.map((b) => b.startAt.getTime() - new Date(start).getTime())).toEqual([0, WEEK, 2 * WEEK]);
    expect(series.map((b) => b.seriesIndex)).toEqual([1, 2, 3]);
    expect(new Set(series.map((b) => b.seriesId))).toEqual(new Set([series[0].id]));
    expect((res.body as { bookingId: string }).bookingId).toBe(series[0].id);
    // The same submit again returns the same first week and books nothing more.
    expect(await book(store, start, { weeks: 3 }, "series-key-001")).toMatchObject({ status: 200, body: { bookingId: series[0].id } });
    expect((await store.listBookings("usr_priya")).filter((b) => b.idempotencyKey.startsWith("series-key-001"))).toHaveLength(3);
  });

  it("books nothing when a later week isn't free, and says which weeks", async () => {
    const store = fresh();
    const start = await firstSlot(store);
    // Someone else already has the third week.
    await book(store, new Date(new Date(start).getTime() + 2 * WEEK).toISOString(), {}, "other-guest-1");
    const before = (await store.listBookings("usr_priya")).length;
    const res = await book(store, start, { weeks: 4 });
    expect(res).toEqual({ status: 409, body: { error: "weeks_unavailable", unavailable: [new Date(new Date(start).getTime() + 2 * WEEK).toISOString()] } });
    expect((await store.listBookings("usr_priya")).length).toBe(before);
  });

  it("refuses more weeks than the host allows, and repeats where the event type has none", async () => {
    const start = await firstSlot(fresh());
    expect(await book(fresh(4), start, { weeks: 5 })).toMatchObject({ status: 400, body: { fields: { weeks: "Book up to 4 weeks at a time." } } });
    expect(await book(fresh(1), start, { weeks: 2 })).toMatchObject({ status: 400, body: { fields: { weeks: "This event can't be repeated." } } });
    expect(await book(fresh(4), start, { weeks: 0 })).toMatchObject({ status: 400, body: { fields: { weeks: "Pick 1 to 12 weeks." } } });
    expect(await book(fresh(4), start, { weeks: "3" })).toMatchObject({ status: 400 });
  });

  it("a single booking is unchanged: no series", async () => {
    const store = fresh();
    const res = await book(store, await firstSlot(store), {});
    const b = await store.getBooking("usr_priya", (res.body as { bookingId: string }).bookingId);
    expect([b!.seriesId, b!.seriesIndex]).toEqual([null, null]);
  });
});

describe("managing a week", () => {
  it("a guest cancels one week, or that week and the later ones; earlier weeks stay", async () => {
    const store = fresh();
    const res = await book(store, await firstSlot(store), { weeks: 4 }, "series-manage-1");
    const weeks = () => store.listBookings("usr_priya").then((all) => all.filter((b) => b.seriesId === (res.body as { bookingId: string }).bookingId).sort((a, b) => a.seriesIndex! - b.seriesIndex!));
    const [, second, third] = await weeks();
    expect(await handleCancel(store, second.invitee.manageToken, null, now)).toMatchObject({ status: 200 });
    expect((await weeks()).map((b) => b.status)).toEqual(["confirmed", "cancelled", "confirmed", "confirmed"]);
    expect(await handleCancel(store, third.invitee.manageToken, null, now, { laterWeeks: true })).toMatchObject({ status: 200 });
    expect((await weeks()).map((b) => b.status)).toEqual(["confirmed", "cancelled", "cancelled", "cancelled"]);
  });

  it("a moved week keeps its place in the series", async () => {
    const store = fresh();
    const res = await book(store, await firstSlot(store), { weeks: 2 }, "series-move-1");
    const first = (res.body as { bookingId: string }).bookingId;
    const second = (await store.listBookings("usr_priya")).find((b) => b.seriesId === first && b.seriesIndex === 2)!;
    const slots = await handleGetSlots(store, new URLSearchParams({ slug: "priya", event: "coaching", from: now.toISOString(), to: new Date(now.getTime() + 50 * DAY).toISOString(), tz: "Asia/Kolkata", token: second.invitee.manageToken }), now);
    const newTime = (slots.body as { slots: string[] }).slots.find((s) => new Date(s).getTime() > second.startAt.getTime() + DAY)!;
    const moved = await handleReschedule(store, second.invitee.manageToken, { start: newTime, idempotencyKey: "series-move-key" }, now);
    expect(moved.status).toBe(201);
    const after = await store.getBooking("usr_priya", (moved.body as { bookingId: string }).bookingId);
    expect([after!.seriesId, after!.seriesIndex]).toEqual([first, 2]);
  });
});

describe("event type setting", () => {
  const form = { ...NEW_EVENT_TYPE_FORM, name: "Weekly call", slug: "weekly" };
  it("takes 1 to 12 weeks, on free event types only", () => {
    expect(validateEventType({ ...form, maxRepeats: "6" }, [])).toMatchObject({ ok: true, value: { maxRepeats: 6 } });
    expect(validateEventType({ ...form, maxRepeats: "13" }, [])).toMatchObject({ ok: false, errors: { maxRepeats: expect.any(String) } });
    expect(validateEventType({ ...form, maxRepeats: "4", price: "499" }, [])).toMatchObject({ ok: false, errors: { maxRepeats: expect.stringContaining("free") } });
    expect(validateEventType({ ...form, maxRepeats: "1", price: "499" }, [])).toMatchObject({ ok: true });
  });
});
