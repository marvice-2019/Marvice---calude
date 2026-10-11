import { describe, expect, it } from "vitest";
import { cleanRedirectUrl, googleCalendarLink, outlookCalendarLink } from "./calendar-links";

const e = { title: "Coaching with Priya", details: "Change or cancel: https://hourhand.test/b/abc", location: "https://meet.google.com/x-y-z",
  start: new Date("2026-11-03T04:30:00Z"), end: new Date("2026-11-03T05:30:00Z") };

describe("add to calendar", () => {
  it("fills in Google's event form", () => {
    const u = new URL(googleCalendarLink(e));
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(u.searchParams)).toEqual({ action: "TEMPLATE", text: e.title, dates: "20261103T043000Z/20261103T053000Z", details: e.details, location: e.location });
  });

  it("fills in Outlook's, and leaves out an empty location", () => {
    const u = new URL(outlookCalendarLink({ ...e, location: null }));
    expect(u.searchParams.get("startdt")).toBe("2026-11-03T04:30:00.000Z");
    expect(u.searchParams.get("enddt")).toBe("2026-11-03T05:30:00.000Z");
    expect(u.searchParams.get("subject")).toBe(e.title);
    expect(u.searchParams.has("location")).toBe(false);
  });
});

describe("redirect after booking", () => {
  it("takes https addresses only; empty clears it", () => {
    expect(cleanRedirectUrl(" https://priya.coach/thanks ")).toBe("https://priya.coach/thanks");
    expect(cleanRedirectUrl("")).toBeNull();
    for (const bad of ["http://priya.coach", "javascript:alert(1)", "data:text/html,x", "priya.coach/thanks", `https://x.in/${"a".repeat(500)}`]) {
      expect(cleanRedirectUrl(bad)).toBeUndefined();
    }
    // Short as typed, over 500 once spaces are encoded: the stored form is what's measured.
    expect(cleanRedirectUrl(`https://x.in/${"a b".repeat(120)}`)).toBeUndefined();
  });
});
