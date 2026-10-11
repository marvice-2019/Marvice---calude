import { describe, expect, it } from "vitest";
import { GAZETTED_HOLIDAYS, pickHolidayDates, upcomingHolidays } from "./holidays";

describe("gazetted holidays", () => {
  it("are real dates in order with no repeats", () => {
    for (const h of GAZETTED_HOLIDAYS) expect(new Date(`${h.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(h.date);
    const dates = GAZETTED_HOLIDAYS.map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("lists the next year from the host's today, soonest first", () => {
    const next = upcomingHolidays("2026-10-11");
    expect(next[0]).toEqual({ date: "2026-10-20", name: "Dussehra" });
    expect(next.at(-1)?.date).toBe("2027-10-09");
    expect(next.some((h) => h.date === "2026-10-02")).toBe(false);
  });

  it("blocks only real upcoming holiday dates from a submitted form", () => {
    expect(pickHolidayDates(["2026-11-08", "2026-11-08", "2026-10-02", "2026-12-01", "x"], "2026-10-11")).toEqual(["2026-11-08"]);
  });
});
