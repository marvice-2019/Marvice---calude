import { describe, expect, it } from "vitest";
import { computeSlots, isSyncStale, type SlotInput } from "./slots";
import type { AvailabilityRule } from "./data/types";

// 2026-10-12 is a Monday. India is UTC+05:30 all year.
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const weekly = (weekday: number, intervals: { from: string; to: string }[]): AvailabilityRule => ({ id: `w${weekday}`, scheduleId: "s", kind: "weekly", weekday, onDate: null, intervals });
const override = (onDate: string, intervals: { from: string; to: string }[]): AvailabilityRule => ({ id: `d${onDate}`, scheduleId: "s", kind: "date", weekday: null, onDate, intervals });
const hours = [{ from: "10:00", to: "13:00" }, { from: "15:00", to: "19:00" }];

function input(over: Partial<SlotInput> & { eventType?: Partial<SlotInput["eventType"]> } = {}): SlotInput {
  const { eventType, ...rest } = over;
  return {
    eventType: { id: "et", durationMinutes: 30, startIncrementMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 0, bookingWindowDays: 60, dailyLimit: null, ...eventType },
    schedule: { timezone: "Asia/Kolkata" },
    rules: [1, 2, 3, 4, 5].map((d) => weekly(d, hours)),
    busyBlocks: [],
    bookings: [],
    now: ist("2026-10-11", "00:00"),
    rangeStart: ist("2026-10-12", "00:00"),
    rangeEnd: ist("2026-10-13", "00:00"),
    syncStale: false,
    ...rest,
  };
}
const times = (slots: Date[]) =>
  slots.map((d) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }));
const booking = (start: Date, end: Date, eventTypeId = "other") => ({ eventTypeId, status: "confirmed" as const, startAt: start, bufferedStart: start, bufferedEnd: end });

describe("computeSlots", () => {
  it("expands weekly hours into slots in UTC", () => {
    const slots = computeSlots(input());
    expect(slots).toHaveLength(14);
    expect(slots[0].toISOString()).toBe("2026-10-12T04:30:00.000Z");
    expect(times(slots)).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]);
  });

  it("a date override with no hours removes the day", () => {
    expect(computeSlots(input({ rules: [weekly(1, hours), override("2026-10-12", [])] }))).toEqual([]);
  });

  it("a date override with custom hours replaces the weekly hours", () => {
    expect(times(computeSlots(input({ rules: [weekly(1, hours), override("2026-10-12", [{ from: "14:00", to: "15:00" }])] })))).toEqual(["14:00", "14:30"]);
  });

  it("removes slots that overlap a busy block", () => {
    const slots = times(computeSlots(input({ busyBlocks: [{ start: ist("2026-10-12", "11:15"), end: ist("2026-10-12", "11:45") }] })));
    expect(slots).not.toContain("11:00");
    expect(slots).not.toContain("11:30");
    expect(slots).toContain("10:30");
    expect(slots).toContain("12:00");
  });

  it("buffers block an overlapping neighbour but allow one that only touches", () => {
    const slots = times(computeSlots(input({
      eventType: { startIncrementMinutes: 15, bufferBeforeMinutes: 15 },
      rules: [weekly(1, [{ from: "10:00", to: "13:00" }])],
      bookings: [booking(ist("2026-10-12", "11:00"), ist("2026-10-12", "11:30"))],
    })));
    expect(slots).toContain("10:30"); // buffered [10:15, 11:00) touches the booking
    expect(slots).not.toContain("10:45"); // [10:30, 11:15) overlaps
    expect(slots).not.toContain("11:30"); // buffered [11:15, 12:00) overlaps
    expect(slots).toContain("11:45"); // buffered [11:30, 12:15) touches
  });

  it("respects minimum notice from now", () => {
    const slots = times(computeSlots(input({ now: ist("2026-10-12", "10:20"), eventType: { minNoticeMinutes: 60 } })));
    expect(slots[0]).toBe("11:30");
  });

  it("respects the booking window", () => {
    const slots = computeSlots(input({ now: ist("2026-10-12", "00:00"), rangeEnd: ist("2026-10-15", "00:00"), eventType: { bookingWindowDays: 1 } }));
    expect(slots).toHaveLength(14);
    expect(slots.every((s) => s < ist("2026-10-13", "00:00"))).toBe(true);
  });

  it("steps starts by the increment", () => {
    expect(times(computeSlots(input({ eventType: { startIncrementMinutes: 60 } })))).toEqual(["10:00", "11:00", "12:00", "15:00", "16:00", "17:00", "18:00"]);
  });

  it("stops offering a day once its daily limit is reached", () => {
    const slots = computeSlots(input({
      eventType: { dailyLimit: 1 },
      rangeEnd: ist("2026-10-14", "00:00"),
      bookings: [booking(ist("2026-10-12", "18:30"), ist("2026-10-12", "19:00"), "et")],
    }));
    expect(slots.some((s) => s < ist("2026-10-13", "00:00"))).toBe(false);
    expect(slots).toHaveLength(14); // Tuesday is untouched
  });

  it("offers nothing while calendar sync is stale", () => {
    expect(computeSlots(input())).not.toHaveLength(0);
    expect(computeSlots(input({ syncStale: true }))).toEqual([]);
  });

  it("keeps the host's wall-clock hours across a daylight-saving change (London, 25 Oct 2026)", () => {
    const slots = computeSlots(input({
      schedule: { timezone: "Europe/London" },
      eventType: { durationMinutes: 60, startIncrementMinutes: 60 },
      rules: [1, 2, 3, 4, 5].map((d) => weekly(d, [{ from: "09:00", to: "10:00" }])),
      now: new Date("2026-10-22T00:00:00Z"),
      rangeStart: new Date("2026-10-23T00:00:00Z"),
      rangeEnd: new Date("2026-10-27T00:00:00Z"),
    }));
    expect(slots.map((s) => s.toISOString())).toEqual(["2026-10-23T08:00:00.000Z", "2026-10-26T09:00:00.000Z"]);
  });
});

describe("isSyncStale", () => {
  const now = new Date("2026-10-12T06:00:00Z");
  it("is stale when the last good sync is over 15 minutes old or the connection is not ok", () => {
    expect(isSyncStale([{ status: "ok", lastSyncedAt: new Date(now.getTime() - 2 * 60_000) }], now)).toBe(false);
    expect(isSyncStale([{ status: "ok", lastSyncedAt: new Date(now.getTime() - 20 * 60_000) }], now)).toBe(true);
    expect(isSyncStale([{ status: "degraded", lastSyncedAt: now }], now)).toBe(true);
  });
});
