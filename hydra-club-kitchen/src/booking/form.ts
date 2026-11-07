/**
 * Booking-form helpers shared by the browser and the tests. No server imports:
 * this file ships in the client bundle. Rules mirror createBookingSchema in
 * service.ts; the server stays the authority.
 */
import { toIndianE164 } from "./phone";

export type FormValues = { name: string; phone: string; guests: number; notes: string; consent: boolean };
export type FieldErrors = Partial<Record<"table" | "date" | "time" | "guests" | "name" | "phone" | "notes" | "consent", string>>;

export function validateBookingForm(v: FormValues, opts: { maxGuests: number; table: string | null; time: string | null }): FieldErrors {
  const e: FieldErrors = {};
  if (!opts.table) e.table = "Pick a table on the floor plan.";
  if (!opts.time) e.time = "Pick a time.";
  const name = v.name.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!name) e.name = "Tell us your name.";
  else if (name.length > 80) e.name = "Keep the name under 80 characters.";
  if (!toIndianE164(v.phone)) e.phone = "Enter a 10-digit Indian mobile number.";
  if (!Number.isInteger(v.guests) || v.guests < 1) e.guests = "At least 1 guest.";
  else if (v.guests > opts.maxGuests) e.guests = `This table takes up to ${opts.maxGuests} guests.`;
  if (v.notes.length > 500) e.notes = "Keep notes under 500 characters.";
  if (!v.consent) e.consent = "Tick the box so we can contact you about this booking.";
  return e;
}

/** Last 4 digits of the guest's mobile: the key for lookup, cancel and the .ics link. */
export const last4 = (phone: string) => (toIndianE164(phone) ?? "").slice(-4);

/** wa.me deep link to the venue, or null when no WhatsApp number is set (never render a broken link). */
export function whatsappLink(venueNumber: string, text: string): string | null {
  const digits = venueNumber.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function bookingSummary(b: { ref: string; date: string; time: string; table: string; guests: number; name: string }): string {
  const day = new Date(`${b.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `Hydra Club & Kitchen booking ${b.ref}: ${b.name}, ${b.guests} guests, table ${b.table}, ${day} at ${formatTime(b.time)}.`;
}

/** "21:30" → "9:30 PM"; "00:00" → "12:00 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"] as const;

/** Campaign parameters from a landing URL's query string; only the whitelisted keys, each capped at 200 chars. */
export function pickUtm(search: string): Record<string, string> | null {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k)?.trim();
    if (v) out[k] = v.slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}
