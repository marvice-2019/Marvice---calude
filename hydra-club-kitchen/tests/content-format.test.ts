import { describe, expect, it } from "vitest";
import type { WeekHours } from "@/booking/time";
import { formatRupees, formatTime, hoursSummary, nextNightDate, numbersFor } from "@/components/content/format";

const day = { open: "11:30", close: "01:00" };
const every: WeekHours = { sun: day, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day };

describe("formatRupees", () => {
  it("formats paise with en-IN grouping", () => {
    expect(formatRupees(45000)).toBe("₹450");
    expect(formatRupees(12345600)).toBe("₹1,23,456");
    expect(formatRupees(19950)).toBe("₹199.50");
    expect(formatRupees(0)).toBe("₹0");
  });
});

describe("hoursSummary", () => {
  it("collapses seven identical days", () => {
    expect(hoursSummary(every)).toEqual(["Open every day · 11:30 AM – 1 AM"]);
  });
  it("groups consecutive days and shows closed days", () => {
    const late = { open: "12:00", close: "02:00" };
    expect(hoursSummary({ ...every, mon: null, fri: late, sat: late })).toEqual([
      "Mon · Closed",
      "Tue–Thu · 11:30 AM – 1 AM",
      "Fri–Sat · 12 PM – 2 AM",
      "Sun · 11:30 AM – 1 AM",
    ]);
  });
  it("hides unconfirmed or all-closed hours", () => {
    expect(hoursSummary(null)).toEqual([]);
    expect(hoursSummary({ sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null })).toEqual([]);
  });
  it("formats midnight and noon", () => {
    expect(formatTime("00:00")).toBe("12 AM");
    expect(formatTime("12:15")).toBe("12:15 PM");
  });
});

describe("nextNightDate", () => {
  // 2026-11-06 is a Friday.
  it("returns the next matching service date", () => {
    const wedNoonIst = new Date("2026-11-04T06:30:00Z");
    expect(nextNightDate("5,6", wedNoonIst, 14)).toBe("2026-11-06");
    expect(nextNightDate("7", wedNoonIst, 14)).toBe("2026-11-08");
  });
  it("treats 2 AM Saturday as Friday night (05:00 cutoff)", () => {
    const sat2amIst = new Date("2026-11-06T20:30:00Z");
    expect(nextNightDate("5", sat2amIst, 14)).toBe("2026-11-06");
    const sat6amIst = new Date("2026-11-07T00:30:00Z");
    expect(nextNightDate("5", sat6amIst, 14)).toBe("2026-11-13");
  });
  it("is null outside the window or for a bad rule", () => {
    const wedNoonIst = new Date("2026-11-04T06:30:00Z");
    expect(nextNightDate("5", wedNoonIst, 2)).toBeNull();
    expect(nextNightDate("", wedNoonIst, 14)).toBeNull();
    expect(nextNightDate("9,x", wedNoonIst, 14)).toBeNull();
  });
});

describe("numbersFor", () => {
  const zones = [
    { key: "standard", tableCount: 12 },
    { key: "vip", tableCount: 2 },
    { key: "vvip", tableCount: 2 },
    { key: "mezz", tableCount: 4 },
  ];
  it("shows only stats backed by data", () => {
    expect(numbersFor({ totalTables: 20, zones, hours: every, costForTwoInr: 2000 }).map((s) => [s.value, s.label])).toEqual([
      [20, "Tables to book"],
      [4, "Zones on the floor"],
      [4, "VIP & VVIP tables"],
      [7, "Nights a week"],
      [2000, "About, for two"],
    ]);
  });
  it("drops stats with null or empty data", () => {
    expect(numbersFor({ totalTables: 0, zones: [], hours: null, costForTwoInr: null })).toEqual([]);
    const noVip = zones.map((z) => (z.key.startsWith("v") ? { ...z, tableCount: 0 } : z));
    expect(numbersFor({ totalTables: 16, zones: noVip, hours: null, costForTwoInr: null }).map((s) => s.label)).toEqual([
      "Tables to book",
      "Zones on the floor",
    ]);
  });
});
