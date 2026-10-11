import { describe, expect, it } from "vitest";
import { resolveCycle } from "./time-format";

describe("resolveCycle", () => {
  it("prefers a stored 24h or 12h choice over the locale", () => {
    expect(resolveCycle("24h", "h12")).toBe("24h");
    expect(resolveCycle("12h", "h23")).toBe("12h");
  });
  it("falls back to the locale when nothing valid is stored", () => {
    expect(resolveCycle(null, "h23")).toBe("24h");
    expect(resolveCycle("bogus", "h12")).toBe("12h");
    expect(resolveCycle(undefined, "h24")).toBe("24h");
  });
  it("defaults to 12h when the locale cycle is unknown", () => {
    expect(resolveCycle(null, undefined)).toBe("12h");
  });
});
