import { describe, expect, it } from "vitest";
import { parseLocalTimes } from "./links-form";

describe("parseLocalTimes", () => {
  it("reads wall-clock times in the host's zone and skips blank rows", () => {
    expect(parseLocalTimes(["2026-10-20T15:30", "", "2026-10-21T09:00"], "Asia/Kolkata"))
      .toEqual({ ok: true, times: [new Date("2026-10-20T10:00:00Z"), new Date("2026-10-21T03:30:00Z")] });
    expect(parseLocalTimes(["2026-07-01T09:00"], "Europe/London")).toEqual({ ok: true, times: [new Date("2026-07-01T08:00:00Z")] });
  });

  it("names the row that isn't a real date and time", () => {
    expect(parseLocalTimes(["2026-10-20T15:30", "tomorrow"], "Asia/Kolkata")).toEqual({ ok: false, error: "Time 2 isn't a date and time." });
    expect(parseLocalTimes(["2026-02-31T10:00"], "Asia/Kolkata")).toEqual({ ok: false, error: "Time 1 isn't a real date." });
  });
});
