import { describe, expect, it } from "vitest";
import { bookingSummary, formatTime, last4, pickUtm, validateBookingForm, whatsappLink } from "../src/booking/form";
import { FLOOR, hitBox, MIN_HIT, MOBILE_RENDER_WIDTH, VIEWBOX } from "../src/content/floor-plan";
import { TABLES } from "../src/db/seed-data";

describe("floor plan config", () => {
  it("has exactly the 20 seeded tables in the right zones", () => {
    const plan = FLOOR.tables.map((t) => `${t.code}:${t.zone}`).sort();
    expect(plan).toEqual(TABLES.map((t) => `${t.code}:${t.zone}`).sort());
  });

  it("keeps every table and marker inside the viewBox", () => {
    for (const t of FLOOR.tables) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(VIEWBOX.w);
      expect(t.y + t.h).toBeLessThanOrEqual(VIEWBOX.h);
    }
    for (const m of FLOOR.markers) expect(m.x < VIEWBOX.w && m.y < VIEWBOX.h).toBe(true);
  });

  it("gives every table a tap area of at least 44 px at the mobile render width, with no overlaps", () => {
    const scale = MOBILE_RENDER_WIDTH / VIEWBOX.w;
    expect(MIN_HIT * scale).toBeGreaterThanOrEqual(44);
    const boxes = FLOOR.tables.map(hitBox);
    for (const b of boxes) expect(Math.min(b.w, b.h) * scale).toBeGreaterThanOrEqual(44);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${FLOOR.tables[i]!.code} vs ${FLOOR.tables[j]!.code}`).toBe(false);
      }
  });

  it("has markers 1 to 6, unlabelled until Hydra explains them", () => {
    expect(FLOOR.markers.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(FLOOR.markers.every((m) => m.label === null)).toBe(true);
  });
});

describe("booking form helpers", () => {
  const ok = { name: "Asha Rao", phone: "98765 43210", guests: 4, notes: "", consent: true };
  const opts = { maxGuests: 12, table: "T4", time: "21:00" };

  it("accepts a complete form and Indian mobile variants", () => {
    expect(validateBookingForm(ok, opts)).toEqual({});
    for (const phone of ["+91 98765 43210", "09876543210", "919876543210"]) {
      expect(validateBookingForm({ ...ok, phone }, opts)).toEqual({});
    }
  });

  it("flags each missing or bad field with the same words as the server", () => {
    const e = validateBookingForm({ name: " ", phone: "12345", guests: 13, notes: "x".repeat(501), consent: false }, { maxGuests: 12, table: null, time: null });
    expect(e).toEqual({
      table: "Pick a table on the floor plan.",
      time: "Pick a time.",
      name: "Tell us your name.",
      phone: "Enter a 10-digit Indian mobile number.",
      guests: "This table takes up to 12 guests.",
      notes: "Keep notes under 500 characters.",
      consent: "Tick the box so we can contact you about this booking.",
    });
  });

  it("builds the wa.me link only when a venue number is set", () => {
    expect(whatsappLink("", "hi")).toBeNull();
    expect(whatsappLink("+91 70000 00000", "Ref HYD-AB23 & more")).toBe("https://wa.me/917000000000?text=Ref%20HYD-AB23%20%26%20more");
  });

  it("formats times and summaries for guests", () => {
    expect(formatTime("21:30")).toBe("9:30 PM");
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(bookingSummary({ ref: "HYD-AB23", date: "2026-12-04", time: "21:00", table: "T4", guests: 4, name: "Asha" })).toBe(
      "Hydra Club & Kitchen booking HYD-AB23: Asha, 4 guests, table T4, Fri, 4 Dec at 9:00 PM.",
    );
    expect(last4("98765 43210")).toBe("3210");
  });

  it("keeps only whitelisted campaign parameters", () => {
    expect(pickUtm("?utm_source=ig&utm_campaign=nye&ref=x&gclid=abc")).toEqual({ utm_source: "ig", utm_campaign: "nye", gclid: "abc" });
    expect(pickUtm("?ref=x")).toBeNull();
    expect(pickUtm(`?utm_source=${"a".repeat(300)}`)!.utm_source).toHaveLength(200);
  });
});
