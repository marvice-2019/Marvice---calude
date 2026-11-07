import { z } from "zod";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { isHHmm, WEEKDAYS, type Weekday } from "@/booking/time";

const hhmm = z.string().refine(isHHmm, "Use HH:mm");
const dayHours = z.object({ open: hhmm, close: hhmm }).nullable();
const weekHours = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, dayHours])) as Record<Weekday, typeof dayHours>,
);

/**
 * Typed view of the settings table. Unknown keys are ignored; anything missing
 * or malformed falls back to the "unconfirmed" default, which hides the UI
 * that depends on it instead of breaking the page.
 */
export const settingsSchema = z.object({
  whatsapp: z.string().catch(""),
  phone: z.string().catch(""),
  hours: weekHours.nullable().catch(null),
  address: z.string().catch(""),
  address_block_confirmed: z.boolean().catch(false),
  maps_url: z.string().catch(""),
  instagram: z.string().catch(""),
  good_to_know: z.array(z.string()).catch([]),
  cost_for_two_inr: z.number().int().positive().nullable().catch(null),
  cuisines: z.array(z.string()).catch([]),
  slot_length_minutes: z.number().int().min(30).max(360).catch(120),
  booking_window_days: z.number().int().min(1).max(90).catch(14),
  max_guests_per_table: z.number().int().min(1).max(50).catch(12),
  booking_enabled: z.boolean().catch(true),
  /** Turnstile check on bookings. Off until abuse appears (needs TURNSTILE_SECRET_KEY). */
  captcha_enabled: z.boolean().catch(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings);
  return settingsSchema.parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** Guests can book only once hours are confirmed and booking is switched on. */
export const bookingOpen = (s: Settings) => s.booking_enabled && s.hours !== null;
