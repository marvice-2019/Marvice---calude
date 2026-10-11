import { describe, expect, it } from "vitest";
import { waLink, waNumber, whatsappMessage } from "./whatsapp";

describe("waNumber", () => {
  it("adds India's code to ten-digit and 0-prefixed numbers, keeps international ones", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("09876543210")).toBe("919876543210");
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
    expect(waNumber("+44 7700 900123")).toBe("447700900123");
    expect(waNumber("0044 7700 900123")).toBe("447700900123");
  });
  it("refuses what can't be a phone number", () => {
    expect(waNumber(null)).toBeNull();
    expect(waNumber("123")).toBeNull();
    expect(waNumber("call me")).toBeNull();
  });
});

describe("whatsappMessage", () => {
  const c = {
    guestName: "Meera Iyer", hostName: "Priya Raman", eventName: "Coaching session", startAt: new Date("2026-10-20T04:30:00Z"),
    guestTimezone: "Asia/Kolkata", where: "Google Meet: https://meet.google.com/abc-defg-hij", manageUrl: "https://hourhand.cloud/b/tok",
  };
  it("writes the time in the guest's zone, with first name, place and manage link", () => {
    const text = whatsappMessage("confirmation", c);
    expect(text).toContain("Hi Meera, this is Priya Raman.");
    expect(text).toContain("Tuesday, 20 October 2026, 10:00 am IST");
    expect(text).toContain("https://meet.google.com/abc-defg-hij");
    expect(text).toContain("https://hourhand.cloud/b/tok");
    expect(whatsappMessage("reminder", { ...c, where: null })).not.toContain("null");
  });
  it("builds a wa.me link with the message encoded", () => {
    expect(waLink("919876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
  });
});
