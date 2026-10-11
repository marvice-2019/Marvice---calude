import { describe, expect, it } from "vitest";
import { todayIn, validateDateOverride, validateDateRange, validateIntervals, validateWeeklyHours } from "./availability";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import { computeSlots } from "./slots";

const TODAY = "2026-10-10";

describe("availability validation", () => {
  it("accepts valid weekly hours", () => {
    const r = validateWeeklyHours({ 1: [{ from: "09:00", to: "12:00" }, { from: "13:00", to: "17:30" }], 6: [{ from: "10:00", to: "24:00" }], 0: [] });
    expect(r.ok).toBe(true);
  });

  it("rejects a range whose start is not before its end", () => {
    expect(validateIntervals([{ from: "17:00", to: "09:00" }], "w1")).toEqual({ "w1-0-to": "End time must be after the start time." });
    expect(validateIntervals([{ from: "09:00", to: "09:00" }], "w1")).toHaveProperty("w1-0-to");
  });

  it("flags every range that overlaps an earlier, longer one", () => {
    const errors = validateIntervals([{ from: "09:00", to: "17:00" }, { from: "10:00", to: "11:00" }, { from: "12:00", to: "13:00" }], "w1");
    expect(errors).toHaveProperty("w1-1-from");
    expect(errors).toHaveProperty("w1-2-from");
  });

  it("rejects overlapping ranges on the same day", () => {
    const r = validateWeeklyHours({ 2: [{ from: "13:00", to: "17:00" }, { from: "09:00", to: "13:30" }] });
    expect(r).toEqual({ ok: false, errors: { "w2-1-from": "This range overlaps another one on the same day." } });
    // Ranges that only touch are fine.
    expect(validateIntervals([{ from: "09:00", to: "12:00" }, { from: "12:00", to: "13:00" }], "w2")).toEqual({});
  });

  it("rejects badly formatted times", () => {
    for (const bad of ["9:00", "25:00", "24:30", "12:60", "noon", ""]) {
      expect(validateIntervals([{ from: bad, to: "18:00" }], "ov")).toHaveProperty("ov-0-from");
    }
  });

  it("rejects a date in the past and a date that does not exist", () => {
    expect(validateDateOverride("2026-10-09", [], TODAY)).toEqual({ ok: false, errors: { "ov-date": "That date has already passed." } });
    expect(validateDateOverride("2026-02-30", [], TODAY).ok).toBe(false);
    expect(validateDateOverride(TODAY, [], TODAY).ok).toBe(true);
    expect(validateDateRange("2026-10-01", "2026-10-12", TODAY)).toEqual({ ok: false, errors: { "block-from": "That date has already passed." } });
  });

  it("rejects a range longer than 62 days, and one that ends before it starts", () => {
    expect(validateDateRange("2026-10-12", "2026-12-12", TODAY).ok).toBe(true); // 62 days
    expect(validateDateRange("2026-10-12", "2026-12-13", TODAY)).toEqual({ ok: false, errors: { "block-to": "Block up to 62 days at a time." } });
    expect(validateDateRange("2026-10-12", "2026-10-11", TODAY).ok).toBe(false);
  });

  it("reads today on the schedule's wall clock", () => {
    expect(todayIn("Asia/Kolkata", new Date("2026-10-10T19:00:00Z"))).toBe("2026-10-11");
  });
});

describe("availability in the memory store", () => {
  const NOW = new Date("2026-10-10T06:00:00Z"); // Saturday
  const ist = (date: string, time = "00:00") => new Date(`${date}T${time}:00+05:30`);

  async function slotsFor(store: ReturnType<typeof createMemoryStore>, from: string, to: string) {
    const host = await store.getCurrentUser();
    const { schedule, rules } = await store.getDefaultSchedule(host.id);
    const eventType = (await store.getEventType(host.id, "evt_intro"))!;
    return computeSlots({ eventType, schedule, rules, busyBlocks: [], bookings: [], now: NOW, rangeStart: ist(from), rangeEnd: ist(to), syncStale: false });
  }

  it("weekly hours saved through the store drive computeSlots", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const host = await store.getCurrentUser();
    const { schedule } = await store.getDefaultSchedule(host.id);
    expect(await slotsFor(store, "2026-10-11", "2026-10-12")).toEqual([]); // no Sunday hours in the seed

    await store.saveWeeklyHours(schedule.id, { 0: [{ from: "10:00", to: "11:00" }] });

    const sunday = await slotsFor(store, "2026-10-11", "2026-10-12");
    expect(sunday.map((d) => d.toISOString())).toEqual(["2026-10-11T04:30:00.000Z", "2026-10-11T04:45:00.000Z", "2026-10-11T05:00:00.000Z", "2026-10-11T05:15:00.000Z"]);
    expect(await slotsFor(store, "2026-10-12", "2026-10-13")).toEqual([]); // Monday was replaced
  });

  it("blockDateRange over a week leaves no slots on those dates", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const host = await store.getCurrentUser();
    const { schedule } = await store.getDefaultSchedule(host.id);
    expect((await slotsFor(store, "2026-10-12", "2026-10-19")).length).toBeGreaterThan(0);

    await store.blockDateRange(schedule.id, "2026-10-12", "2026-10-18");

    expect(await slotsFor(store, "2026-10-12", "2026-10-19")).toEqual([]);
    expect((await slotsFor(store, "2026-10-19", "2026-10-20")).length).toBeGreaterThan(0);
    await store.deleteDateOverride(schedule.id, "2026-10-13");
    expect((await slotsFor(store, "2026-10-13", "2026-10-14")).length).toBeGreaterThan(0);
  });
});
