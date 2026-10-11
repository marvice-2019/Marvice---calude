import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import { canSayRunningLate, handleRunningLate } from "./manage";
import { renderBookingMail } from "./mail/templates";

const MIN = 60_000;

describe("running late", () => {
  it("opens two hours before the start and closes half an hour after", () => {
    const start = new Date("2026-10-20T10:00:00Z");
    expect(canSayRunningLate(start, new Date(start.getTime() - 121 * MIN))).toBe(false);
    expect(canSayRunningLate(start, new Date(start.getTime() - 120 * MIN))).toBe(true);
    expect(canSayRunningLate(start, new Date(start.getTime() + 30 * MIN))).toBe(true);
    expect(canSayRunningLate(start, new Date(start.getTime() + 31 * MIN))).toBe(false);
  });

  it("records the minutes on a confirmed booking inside the window, and refuses anything else", async () => {
    const store = createMemoryStore(buildSeed(new Date("2026-10-10T04:00:00Z")));
    const booking = (await store.getBookingByManageToken("tok_bkg_1"))!;
    const near = new Date(booking.startAt.getTime() - 30 * MIN);
    expect(await handleRunningLate(store, "tok_bkg_1", { minutes: 7 }, near)).toMatchObject({ status: 400 });
    expect(await handleRunningLate(store, "tok_bkg_1", { minutes: 10 }, new Date(booking.startAt.getTime() - 5 * 60 * MIN))).toEqual({ status: 409, body: { error: "not_now" } });
    expect(await handleRunningLate(store, "nope", { minutes: 10 }, near)).toMatchObject({ status: 404 });
    expect(await handleRunningLate(store, "tok_bkg_1", { minutes: 10 }, near)).toEqual({ status: 200, body: { status: "told", minutes: 10 } });
    const after = (await store.getBookingByManageToken("tok_bkg_1"))!;
    expect(after.invitee).toMatchObject({ runningLateMinutes: 10, runningLateAt: near });
    // A cancelled booking can't be late.
    expect(await handleRunningLate(store, "tok_bkg_3", { minutes: 10 }, near)).toMatchObject({ status: 409, body: { error: "not_confirmed" } });
  });

  it("emails the host how late, with the guest as reply-to", () => {
    const mail = renderBookingMail("late_host", {
      bookingId: "b", eventName: "Coaching", hostName: "Priya", hostEmail: "p@x.in", hostTimezone: "Asia/Kolkata", hostTimeFormat: "12h",
      guestName: "Meera", guestEmail: "m@x.in", guestTimezone: "Asia/Kolkata", startAt: new Date("2026-10-20T04:30:00Z"), endAt: new Date("2026-10-20T05:15:00Z"),
      location: null, joinUrl: null, answers: [], cancelledBy: null, cancelReason: null, previousStartAt: null, issuedAt: new Date(),
      manageUrl: "https://h/b/t", dashboardUrl: "https://h/dashboard/bookings/b", runningLateMinutes: 15,
    });
    expect(mail.subject).toBe("Running late: Meera, 15 min, Coaching");
    expect(mail.text).toContain("about 15 minutes late for Coaching at 10:00 am");
    expect(mail.replyTo).toBe("m@x.in");
  });
});
