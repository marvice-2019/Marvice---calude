// Guest emails and WhatsApp texts in the language the guest booked in.
import { describe, expect, it } from "vitest";
import { validateBookingRequest } from "../booking";
import { renderBookingMail, type BookingMailContext } from "../mail/templates";
import { whatsappMessage } from "../whatsapp";
import { LOCALES } from "./guest";
import { MAIL_CATALOGS } from "./mail";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const ctx: BookingMailContext = {
  bookingId: "b1", eventName: "Coaching", hostName: "Priya Sharma", hostEmail: "priya@example.com", hostTimezone: "Asia/Kolkata", hostTimeFormat: "24h",
  guestName: "Kiran", guestEmail: "kiran@example.com", guestTimezone: "Asia/Kolkata",
  startAt: new Date("2026-11-03T04:30:00Z"), endAt: new Date("2026-11-03T05:00:00Z"),
  location: { kind: "in_person", value: "12 MG Road" }, joinUrl: null, answers: [],
  cancelledBy: "host", cancelReason: null, previousStartAt: null, paidMinor: 50000,
  issuedAt: new Date("2026-10-11T00:00:00Z"),
  manageUrl: "https://hourhand.test/b/manage-token", dashboardUrl: "https://hourhand.test/dashboard/bookings/b1",
};

describe("mail catalog", () => {
  it("has every English key, non-empty, with the same placeholders, in every language", () => {
    for (const locale of LOCALES) {
      for (const [key, english] of Object.entries(MAIL_CATALOGS.en)) {
        const line = (MAIL_CATALOGS[locale] as Record<string, string | undefined>)[key];
        expect(line?.trim(), `${locale}.${key}`).toBeTruthy();
        expect(placeholders(line ?? ""), `${locale}.${key}`).toEqual(placeholders(english));
      }
    }
  });
});

describe("guest emails follow the booking's language", () => {
  it("writes a Tamil guest's confirmation in Tamil, with Tamil dates and place, and keeps the manage link", () => {
    const m = renderBookingMail("booked_guest", { ...ctx, locale: "ta" });
    expect(m.subject).toBe(`முன்பதிவு உறுதி: Priya Sharma உடன் Coaching, ${new Intl.DateTimeFormat("ta-IN-u-nu-latn", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(ctx.startAt)}`);
    expect(m.text).toContain("வணக்கம் Kiran");
    expect(m.text).toContain("நேரில்"); // in person
    expect(m.text).toContain("நேரத்தை மாற்ற அல்லது ரத்து செய்ய: https://hourhand.test/b/manage-token");
    expect(m.text).toContain("30 நிமிடம்");
    expect(m.text).not.toMatch(/You're booked|Reschedule or cancel/);
  });

  it("tells a Hindi guest about the refund in Hindi when the host cancels", () => {
    const m = renderBookingMail("cancelled_guest", { ...ctx, locale: "hi" });
    expect(m.subject).toBe("रद्द: Priya Sharma के साथ Coaching");
    expect(m.text).toContain("Priya Sharma ने आपकी बुकिंग रद्द कर दी");
    expect(m.text).toContain("₹500 का भुगतान");
  });

  it("writes an extra guest's invitation in the booking's language, still without the manage link", () => {
    const m = renderBookingMail("booked_guest", { ...ctx, locale: "kn", extraGuest: true });
    expect(m.subject.startsWith("ಆಹ್ವಾನ:")).toBe(true);
    expect(m.text).not.toContain("manage-token");
  });

  it("keeps the host's own emails in English, and an unknown language falls back to English", () => {
    expect(renderBookingMail("booked_host", { ...ctx, locale: "ta" }).subject.startsWith("New booking:")).toBe(true);
    expect(renderBookingMail("booked_guest", { ...ctx, locale: "xx" }).subject.startsWith("Booked:")).toBe(true);
  });

  it("writes the WhatsApp texts in the guest's language", () => {
    const msg = whatsappMessage("reminder", { guestName: "Kiran Rao", hostName: "Priya", eventName: "Coaching", startAt: ctx.startAt, guestTimezone: "Asia/Kolkata", where: null, manageUrl: "https://h.test/b/x", locale: "te" });
    expect(msg.startsWith("నమస్తే Kiran, Priya నుండి రిమైండర్: Coaching")).toBe(true);
    expect(msg).toContain("https://h.test/b/x");
  });

  it("takes the page's language with the booking, and English for anything else", () => {
    const req = { slug: "priya", event: "coaching", start: "2031-04-01T05:00:00.000Z", name: "Kiran", email: "kiran@example.in", timezone: "Asia/Kolkata", idempotencyKey: "lang-key-1" };
    const v = validateBookingRequest({ ...req, locale: "ta" });
    expect(v.ok && v.value.locale).toBe("ta");
    const w = validateBookingRequest({ ...req, locale: "fr" });
    expect(w.ok && w.value.locale).toBe("en");
  });
});
