import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsText } from "./ics";

describe("ics", () => {
  it("escapes text values", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("escapes a bare carriage return too, so a guest name can't start a new property", () => {
    expect(icsText("Ravi\rATTENDEE:mailto:x@evil.test")).toBe("Ravi\\nATTENDEE:mailto:x@evil.test");
    expect(icsText("a\r\nb")).toBe("a\\nb");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"मीरा ".repeat(30)}`;
    const folded = foldLine(line).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const l of folded) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(line);
  });

  it("builds an event in UTC with CRLF line endings", () => {
    const ics = buildIcs({ uid: "b1@hourhand", start: new Date("2026-11-03T04:30:00Z"), end: new Date("2026-11-03T05:00:00Z"), stamp: new Date("2026-10-11T00:00:00Z"),
      summary: "Coaching, with Priya", description: "Change: https://x/b/t", location: null, url: "https://x/b/t" });
    expect(ics).toContain("DTSTART:20261103T043000Z\r\n");
    expect(ics).toContain("SUMMARY:Coaching\\, with Priya\r\n");
    expect(ics).not.toContain("LOCATION");
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });
});
