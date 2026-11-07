/**
 * Booking time rules. Everything is Asia/Kolkata (UTC+05:30, no DST), stored as UTC.
 *
 * A "service date" is the night a booking belongs to. Times before the 05:00
 * cutoff belong to the previous service date, so on the night of 8 Dec a
 * 00:30 slot is 9 Dec 00:30 IST on the clock but service date 8 Dec. The
 * database derives the same value in the generated column bookings.service_date.
 */
import { SERVICE_DAY_CUTOFF_HOUR } from "@/db/schema";

export const IST_OFFSET_MIN = 330;
/** Slots start every 30 minutes. */
export const SLOT_STEP_MIN = 30;
/** The last bookable start is at least this long before closing. */
export const LAST_START_BEFORE_CLOSE_MIN = 60;

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type DayHours = { open: string; close: string } | null;
export type WeekHours = Record<Weekday, DayHours>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isIsoDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const isHHmm = (s: string) => TIME_RE.test(s);

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const fmt = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

/** Minutes after the service date's midnight; times before the cutoff roll into the next calendar day. */
function serviceMinutes(hhmm: string): number {
  const m = toMin(hhmm);
  return m < SERVICE_DAY_CUTOFF_HOUR * 60 ? m + 1440 : m;
}

/** UTC instant of a slot: service date + HH:mm in IST. */
export function slotStartUtc(serviceDate: string, hhmm: string): Date {
  const midnightIstAsUtc = Date.parse(`${serviceDate}T00:00:00Z`) - IST_OFFSET_MIN * 60_000;
  return new Date(midnightIstAsUtc + serviceMinutes(hhmm) * 60_000);
}

/** The service date an instant belongs to. Mirrors bookings.service_date. */
export function serviceDateOf(instant: Date): string {
  const shifted = instant.getTime() + IST_OFFSET_MIN * 60_000 - SERVICE_DAY_CUTOFF_HOUR * 3_600_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export type Slot = { time: string; startsAt: Date; endsAt: Date };

/**
 * Bookable slots for one service date. Opening hours come from settings; a
 * close earlier than the open (e.g. 11:30 → 01:00) runs past midnight. A slot
 * lasts `slotLengthMin` but never runs past closing.
 */
export function slotsFor(hours: WeekHours | null, serviceDate: string, slotLengthMin: number): Slot[] {
  const day = hours?.[weekdayOf(serviceDate)];
  if (!day) return [];
  const open = toMin(day.open);
  const close = serviceMinutes(day.close); // 01:00 → 25:00, so 11:30–01:00 spans midnight
  if (close <= open) return []; // inconsistent hours: show no slots rather than guess
  const slots: Slot[] = [];
  for (let m = open; m <= close - LAST_START_BEFORE_CLOSE_MIN; m += SLOT_STEP_MIN) {
    const time = fmt(m);
    const startsAt = slotStartUtc(serviceDate, time);
    const endMin = Math.min(m + slotLengthMin, close);
    slots.push({ time, startsAt, endsAt: new Date(startsAt.getTime() + (endMin - m) * 60_000) });
  }
  return slots;
}

/** Service dates a guest may book: today's service date and the next `windowDays - 1`. */
export function bookableDates(now: Date, windowDays: number): string[] {
  const today = serviceDateOf(now);
  return Array.from({ length: windowDays }, (_, i) => addDays(today, i));
}
