import type { Interval } from "./data/types";

// Pure checks for the availability screen. Error keys match the input ids on the page,
// so each message lands next to the field it is about.

export type FieldErrors = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** Weekday (0 = Sunday … 6 = Saturday) to its hours. A missing or empty day is unavailable. */
export type WeeklyHours = Record<number, Interval[]>;

export const MAX_BLOCK_DAYS = 62;
const DAY_MS = 86_400_000;

/** Minutes since midnight for "HH:MM" between 00:00 and 24:00, or null when the format is wrong. */
export function parseTime(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** Checks one day's ranges: each well formed, start before end, none overlapping. Keys are `${prefix}-${i}-from|to`. */
export function validateIntervals(intervals: Interval[], prefix: string): FieldErrors {
  const errors: FieldErrors = {};
  const good: { i: number; from: number; to: number }[] = [];
  intervals.forEach((iv, i) => {
    const from = parseTime(iv.from);
    const to = parseTime(iv.to);
    if (from === null) errors[`${prefix}-${i}-from`] = "Use a time like 09:00.";
    if (to === null) errors[`${prefix}-${i}-to`] = "Use a time like 17:00.";
    if (from === null || to === null) return;
    if (from >= to) errors[`${prefix}-${i}-to`] = "End time must be after the start time.";
    else good.push({ i, from, to });
  });
  good.sort((a, b) => a.from - b.from);
  for (let k = 1; k < good.length; k++) {
    if (good[k].from < good[k - 1].to) {
      const later = Math.max(good[k].i, good[k - 1].i);
      errors[`${prefix}-${later}-from`] = "This range overlaps another one on the same day.";
    }
  }
  return errors;
}

export function validateWeeklyHours(hours: WeeklyHours): Checked<WeeklyHours> {
  const errors: FieldErrors = {};
  const value: WeeklyHours = {};
  for (const [key, intervals] of Object.entries(hours)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors[`w${key}`] = "Unknown day.";
      continue;
    }
    Object.assign(errors, validateIntervals(intervals, `w${day}`));
    value[day] = intervals;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date (YYYY-MM-DD) on the wall clock of `timezone`. */
export function todayIn(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dateError(value: string, today: string): string | null {
  if (!isValidDate(value)) return "Pick a date.";
  if (value < today) return "That date has already passed.";
  return null;
}

/** One date with custom hours, or with no hours (unavailable all day). */
export function validateDateOverride(date: string, intervals: Interval[], today: string): Checked<{ date: string; intervals: Interval[] }> {
  const errors: FieldErrors = validateIntervals(intervals, "ov");
  const bad = dateError(date, today);
  if (bad) errors["ov-date"] = bad;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { date, intervals } };
}

/** Every date from `from` to `to`, both included. Both must be valid and in order. */
export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** A stretch of days to block: real dates, not in the past, in order, at most 62 days. */
export function validateDateRange(from: string, to: string, today: string): Checked<{ from: string; to: string }> {
  const errors: FieldErrors = {};
  const badFrom = dateError(from, today);
  const badTo = dateError(to, today);
  if (badFrom) errors["block-from"] = badFrom;
  if (badTo) errors["block-to"] = badTo;
  if (!badFrom && !badTo) {
    if (to < from) errors["block-to"] = "The last day must be on or after the first day.";
    else if (datesInRange(from, to).length > MAX_BLOCK_DAYS) errors["block-to"] = `Block up to ${MAX_BLOCK_DAYS} days at a time.`;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { from, to } };
}
