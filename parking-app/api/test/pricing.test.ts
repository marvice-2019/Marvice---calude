import { describe, expect, it } from "vitest";
import { financialYear, istWeekday, quote } from "../src/pricing.js";

// SPEC §6 cases. API is paise-exact; the prototype rounds GST to the rupee for display.
const at = (s: string) => new Date(s);
const h = (from: Date, hours: number) => new Date(from.getTime() + hours * 3_600_000);
const FIRST50 = { code: "FIRST50", percentOff: 50, maxOffPaise: 10_000 };
const WEEKEND20 = { code: "WEEKEND20", percentOff: 20, maxOffPaise: 20_000 };

describe("quote (DRV-02, DRV-06)", () => {
  const from = at("2026-10-12T10:00:00+05:30");
  it("3 h at ₹40 = ₹159.30", () => expect(quote(4000, from, h(from, 3), 1500).totalPaise).toBe(15_930));
  it("FIRST50 on 3 h = ₹88.50", () => {
    const q = quote(4000, from, h(from, 3), 1500, FIRST50);
    expect([q.discountPaise, q.gstPaise, q.totalPaise]).toEqual([6000, 1350, 8850]);
  });
  it("FIRST50 capped at ₹100 on 10 h (daily cap ₹320) = ₹277.30", () => {
    const q = quote(4000, from, h(from, 10), 1500, FIRST50);
    expect([q.basePaise, q.discountPaise, q.totalPaise]).toEqual([32_000, 10_000, 27_730]);
  });
  it("WEEKEND20 on 3 h = ₹130.98", () => expect(quote(4000, from, h(from, 3), 1500, WEEKEND20).totalPaise).toBe(13_098));
  it("30 h = one capped day + 6 h", () => expect(quote(4000, from, h(from, 30), 1500).basePaise).toBe(32_000 + 24_000));
  it("partial hour counts as a started hour, minimum 1", () => {
    expect(quote(4000, from, new Date(from.getTime() + 61 * 60_000), 1500).hours).toBe(2);
    expect(quote(4000, from, new Date(from.getTime() + 5 * 60_000), 1500).hours).toBe(1);
  });
  it("platform fee is never discounted", () => expect(quote(4000, from, h(from, 1), 1500, { code: "X", percentOff: 100, maxOffPaise: 1e9 }).totalPaise).toBe(1500 + 270));
});

describe("India time helpers", () => {
  it("weekday uses IST: Sat 00:30 IST is Fri 19:00 UTC", () => expect(istWeekday(at("2026-10-09T19:00:00Z"))).toBe(6));
  it("financial year flips on 1 April IST", () => {
    expect(financialYear(at("2026-03-31T18:00:00Z"))).toBe("2025-26");
    expect(financialYear(at("2026-03-31T18:31:00Z"))).toBe("2026-27");
  });
});
