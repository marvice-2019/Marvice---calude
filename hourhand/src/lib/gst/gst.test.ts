import { describe, expect, it } from "vitest";
import { financialYear, gstinCheckChar, invoiceNumber, isValidGstin, placeOfSupply, splitInclusive } from "./gst";

describe("GSTIN", () => {
  it("accepts a well-formed GSTIN and refuses a wrong check character, state or shape", () => {
    // A GSTIN widely published as a format example; its check character is computed by the standard scheme.
    const base = "27AAPFU0939F1Z";
    const good = base + gstinCheckChar(base);
    expect(isValidGstin(good)).toBe(true);
    expect(isValidGstin(good.toLowerCase())).toBe(true);
    const wrong = base + (gstinCheckChar(base) === "A" ? "B" : "A");
    expect(isValidGstin(wrong)).toBe(false);
    expect(isValidGstin("99AAPFU0939F1Z" + gstinCheckChar("99AAPFU0939F1Z"))).toBe(false); // no state 99
    expect(isValidGstin("27AAPFU0939F1Y5")).toBe(false); // 14th character must be Z
    expect(isValidGstin("27AAPFU0939")).toBe(false);
  });

  it("computes the published check character for known GSTINs", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V"); // 27AAPFU0939F1ZV, the common worked example
  });
});

describe("financial year", () => {
  it("runs April to March in IST", () => {
    expect(financialYear(new Date("2026-04-01T00:00:00+05:30"))).toBe("2627");
    expect(financialYear(new Date("2026-03-31T23:59:00+05:30"))).toBe("2526");
    expect(financialYear(new Date("2026-03-31T19:00:00Z"))).toBe("2627"); // 00:30 IST on 1 April
    expect(financialYear(new Date("2099-12-31T00:00:00Z"))).toBe("9900");
  });
});

describe("invoice number", () => {
  it("fits Rule 46's 16 characters", () => {
    expect(invoiceNumber("HH", "2627", 123)).toBe("HH/2627/000123");
    expect(invoiceNumber("HH", "2627", 123).length).toBeLessThanOrEqual(16);
    expect(invoiceNumber("MARV", "2627", 7)).toBe("MARV/2627/000007");
    expect(() => invoiceNumber("TOOLONGPREFIX", "2627", 1)).toThrow();
    expect(() => invoiceNumber("H H", "2627", 1)).toThrow();
  });
});

describe("splitting a GST-inclusive price", () => {
  it("adds back up to the amount paid, within a state and across states", () => {
    expect(splitInclusive(49_900, 1800, false)).toEqual({ totalMinor: 49_900, taxableMinor: 42_288, cgstMinor: 3806, sgstMinor: 3806, igstMinor: 0 });
    expect(splitInclusive(49_900, 1800, true)).toEqual({ totalMinor: 49_900, taxableMinor: 42_288, cgstMinor: 0, sgstMinor: 0, igstMinor: 7612 });
    for (const total of [100, 101, 99_999, 1_234_567]) {
      for (const rate of [500, 1200, 1800, 2800]) {
        const s = splitInclusive(total, rate, false);
        expect(s.taxableMinor + s.cgstMinor + s.sgstMinor).toBe(total);
        expect(Math.abs(s.cgstMinor - s.sgstMinor)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("place of supply", () => {
  it("is the host's state unless the guest's state is on record", () => {
    expect(placeOfSupply("29", null)).toBe("29");
    expect(placeOfSupply("29", "33")).toBe("33");
    expect(placeOfSupply("29", "99")).toBe("29");
  });
});
