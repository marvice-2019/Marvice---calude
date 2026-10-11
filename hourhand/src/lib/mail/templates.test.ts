import { describe, expect, it } from "vitest";
import type { BookingEmailKind } from "../data/notifications";
import { renderBookingMail, renderCalendarAlert, renderMagicLink, type BookingMailContext } from "./templates";

const ctx: BookingMailContext = {
  bookingId: "b1", eventName: "Coaching", hostName: "Priya Sharma", hostEmail: "priya@example.com", hostTimezone: "Asia/Kolkata", hostTimeFormat: "24h",
  guestName: `Kiran <script>alert(1)</script>`, guestEmail: "kiran@example.com", guestTimezone: "Europe/London",
  startAt: new Date("2026-11-03T04:30:00Z"), endAt: new Date("2026-11-03T05:00:00Z"),
  location: { kind: "in_person", value: "12 MG Road" }, joinUrl: null, answers: [{ questionId: "q", label: "Goal", answer: "Plan the quarter" }],
  cancelledBy: "guest", cancelReason: "Sick\nday", previousStartAt: new Date("2026-11-02T04:30:00Z"),
  issuedAt: new Date("2026-10-11T00:00:00Z"),
  manageUrl: "https://hourhand.test/b/guest-only-manage-token", dashboardUrl: "https://hourhand.test/dashboard/bookings/b1",
};
const kinds: BookingEmailKind[] = ["booked_guest", "booked_host", "reminder_guest", "cancelled_guest", "cancelled_host", "rescheduled_guest", "rescheduled_host"];

describe("booking emails", () => {
  it.each(kinds)("%s escapes guest input in HTML and keeps subjects on one line", (kind) => {
    const m = renderBookingMail(kind, ctx);
    expect(m.html).not.toContain("<script>");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text.length).toBeGreaterThan(0);
  });

  it.each(kinds.filter((k) => k.endsWith("_host")))("%s never contains the guest's manage link", (kind) => {
    const m = renderBookingMail(kind, ctx);
    expect(m.text + m.html).not.toContain("guest-only-manage-token");
  });

  it("shows the guest their own time zone and the host theirs", () => {
    expect(renderBookingMail("booked_guest", ctx).text).toContain("4:30 am Europe/London");
    expect(renderBookingMail("booked_host", ctx).text).toContain("10:00 IST");
  });

  it("attaches a calendar file to confirmations and moves, and replies go to the other person", () => {
    const guest = renderBookingMail("booked_guest", ctx);
    expect(guest.attachments?.[0].filename).toBe("booking.ics");
    expect(guest.replyTo).toBe("priya@example.com");
    expect(renderBookingMail("rescheduled_guest", ctx).text).toContain("Was:");
    expect(renderBookingMail("booked_host", ctx).replyTo).toBe("kiran@example.com");
  });

  it("renders exactly the same email every time, so a retry with the same idempotency key is accepted", () => {
    expect(renderBookingMail("booked_guest", ctx)).toEqual(renderBookingMail("booked_guest", ctx));
    const ics = Buffer.from(renderBookingMail("booked_guest", ctx).attachments![0].content, "base64").toString("utf8");
    expect(ics).toContain("DTSTAMP:20261011T000000Z"); // from when it was queued, not the clock at send time
  });

  it("puts the guest's answers to questions in the host email", () => {
    expect(renderBookingMail("booked_host", ctx).text).toContain("Goal: Plan the quarter");
  });

  it("shows the Meet link once the calendar event has one", () => {
    const meet = { ...ctx, location: { kind: "google_meet" as const, value: null }, joinUrl: "https://meet.google.com/abc-defg-hij" };
    expect(renderBookingMail("booked_guest", meet).text).toContain("Google Meet: https://meet.google.com/abc-defg-hij");
  });

  it("the calendar alert says bookings are paused and links to the fix", () => {
    const m = renderCalendarAlert({ accountEmail: "priya@gmail.com", disconnected: true, lastError: "invalid_grant", calendarsUrl: "https://hourhand.test/dashboard/calendars" });
    expect(m.subject).toBe("Reconnect your Google Calendar");
    expect(m.text).toContain("https://hourhand.test/dashboard/calendars");
    expect(m.text).toContain("show no times");
  });

  it("sign-in email carries the link", () => {
    expect(renderMagicLink("https://hourhand.test/api/auth/magic-link/verify?token=t").text).toContain("token=t");
  });
});
