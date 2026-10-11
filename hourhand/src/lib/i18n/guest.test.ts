import { describe, expect, it } from "vitest";
import { formatDate, formatTime } from "../format";
import { CATALOGS, LOCALES, resolveLocale, t } from "./guest";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("guest catalog", () => {
  it("has every English key, non-empty, with the same placeholders, in every language", () => {
    for (const locale of LOCALES) {
      for (const [key, english] of Object.entries(CATALOGS.en)) {
        const line = (CATALOGS[locale] as Record<string, string | undefined>)[key];
        expect(line?.trim(), `${locale}.${key}`).toBeTruthy();
        expect(placeholders(line ?? ""), `${locale}.${key}`).toEqual(placeholders(english));
      }
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(Object.keys(CATALOGS.en).sort());
    }
  });

  it("fills placeholders and leaves unknown ones as written", () => {
    expect(t("en", "everyWeek", { n: 3 })).toBe("Every week for 3 weeks");
    expect(t("en", "bookedWith")).toBe("Booked with {brand}");
  });
});

describe("resolveLocale", () => {
  it("prefers a valid ?lang, then the host default, then English", () => {
    expect(resolveLocale("hi", "ta")).toBe("hi");
    expect(resolveLocale(undefined, "ta")).toBe("ta");
    expect(resolveLocale("xx", "ta")).toBe("ta");
    expect(resolveLocale(["hi"], "te")).toBe("te");
    expect(resolveLocale("xx", "fr")).toBe("en");
    expect(resolveLocale(undefined, null)).toBe("en");
  });
});

describe("localized dates and times", () => {
  const at = new Date("2026-10-20T10:00:00Z");
  it("names the month in the guest's language, with Latin digits", () => {
    expect(formatDate(at, "Asia/Kolkata", "ta")).toMatch(/அக்டோபர்/);
    expect(formatDate(at, "Asia/Kolkata", "hi")).toMatch(/20/);
    expect(formatTime(at, "Asia/Kolkata", "24h", "te")).toBe("15:30");
  });
  it("stays English without a locale", () => {
    expect(formatDate(at, "Asia/Kolkata")).toBe("Tuesday, 20 October 2026");
    expect(formatTime(at, "Asia/Kolkata")).toBe("3:30 pm");
  });
});
