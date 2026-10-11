import { describe, expect, it } from "vitest";
import { THEME_KEY, THEME_SCRIPT, parseTheme } from "./theme";
import { zoneCheck } from "./tz-confirm";

const slot = new Date("2026-11-03T04:30:00Z");
const priya = { name: "Priya Sharma", timezone: "Asia/Kolkata" };

describe("zoneCheck", () => {
  it("asks nothing when the guest views their device's zone and the host shares it", () => {
    expect(zoneCheck(slot, "Asia/Kolkata", "Asia/Kolkata", priya)).toEqual({ confirm: false, hostLine: null });
  });

  it("asks the guest to confirm a zone that isn't their device's", () => {
    expect(zoneCheck(slot, "Europe/London", "Asia/Kolkata", priya).confirm).toBe(true);
  });

  it("treats zone aliases on the same clock as the same zone", () => {
    expect(zoneCheck(slot, "Asia/Calcutta", "Asia/Kolkata", priya)).toEqual({ confirm: false, hostLine: null });
  });

  it("shows the host's own time when the host is elsewhere, in the guest's hour cycle", () => {
    expect(zoneCheck(slot, "Europe/London", "Europe/London", priya)).toEqual({ confirm: false, hostLine: "10:00 am IST for Priya" });
    expect(zoneCheck(slot, "Europe/London", "Europe/London", priya, "24h").hostLine).toBe("10:00 IST for Priya");
  });

  it("can't compare without a device zone, so it doesn't ask", () => {
    expect(zoneCheck(slot, "Europe/London", null, priya).confirm).toBe(false);
  });
});

describe("theme", () => {
  it("keeps only light or dark; anything else follows the device", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    for (const v of ["system", "", null, "blue", 1]) expect(parseTheme(v)).toBe("system");
  });

  it("the head script applies a saved choice and survives blocked storage", () => {
    const run = (getItem: () => string | null) => {
      const documentElement = { dataset: {} as Record<string, string> };
      new Function("localStorage", "document", THEME_SCRIPT)({ getItem }, { documentElement });
      return documentElement.dataset.theme;
    };
    expect(run(() => "dark")).toBe("dark");
    expect(run(() => "light")).toBe("light");
    expect(run(() => "<img>")).toBeUndefined();
    expect(run(() => { throw new Error("blocked"); })).toBeUndefined();
    expect(THEME_SCRIPT).toContain(JSON.stringify(THEME_KEY));
  });
});
