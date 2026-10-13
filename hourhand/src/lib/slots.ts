import { TZDate } from "@date-fns/tz";
import type { AvailabilityRule, CalendarConnection, EventType, Interval } from "./data/types";

const MIN = 60_000;
const DAY = 86_400_000;
/** A calendar whose last good sync is older than this cannot be trusted to offer times. */
export const SYNC_STALE_AFTER_MINUTES = 15;

type Range = { start: Date; end: Date };

export interface SlotInput {
  eventType: Pick<
    EventType,
    | "id" | "durationMinutes" | "startIncrementMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes"
    | "minNoticeMinutes" | "bookingWindowDays" | "dailyLimit" | "weeklyLimit"
  > & Partial<Pick<EventType, "seatLimit">>;
  schedule: { timezone: string };
  rules: AvailabilityRule[];
  busyBlocks: Range[];
  bookings: { eventTypeId: string; status: "confirmed" | "cancelled" | "pending_payment"; holdExpiresAt: Date | null; startAt: Date; bufferedStart: Date; bufferedEnd: Date; classKey?: string | null }[];
  now: Date;
  rangeStart: Date;
  rangeEnd: Date;
  /** True when any conflict-checked calendar is out of date. Hourhand then offers no times at all. */
  syncStale: boolean;
}

/** Every seat of one group class shares this: the event type and the class's start. */
export const classKeyOf = (eventTypeId: string, startAt: Date) => `${eventTypeId}@${startAt.toISOString()}`;

/** Half-open [start, end) overlap: ranges that only touch do not overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function isSyncStale(connections: Pick<CalendarConnection, "status" | "lastSyncedAt">[], now: Date): boolean {
  return connections.some(
    (c) => c.status !== "ok" || !c.lastSyncedAt || now.getTime() - c.lastSyncedAt.getTime() > SYNC_STALE_AFTER_MINUTES * MIN,
  );
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "YYYY-MM-DD" for a UTC-midnight timestamp that stands for a calendar date. */
function isoDate(dayMs: number): string {
  return new Date(dayMs).toISOString().slice(0, 10);
}

/** Calendar date (as a UTC-midnight timestamp) of an instant, seen in `tz`. */
export function localDay(instant: Date, tz: string): number {
  const d = new TZDate(instant.getTime(), tz);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The UTC instant of a wall-clock time on a calendar date in `tz`. */
function wallTime(dayMs: number, minutes: number, tz: string): number {
  const d = new Date(dayMs);
  return new TZDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(minutes / 60), minutes % 60, tz).getTime();
}

/** The Monday that starts a local day's week (Monday to Sunday, as the week reads in India). */
export const weekOf = (dayMs: number) => dayMs - ((new Date(dayMs).getUTCDay() + 6) % 7) * DAY;

function intervalsFor(dayMs: number, rules: AvailabilityRule[]): Interval[] {
  const date = isoDate(dayMs);
  const override = rules.find((r) => r.kind === "date" && r.onDate === date);
  if (override) return override.intervals; // replaces the weekly hours; [] means unavailable
  const weekday = new Date(dayMs).getUTCDay();
  return rules.find((r) => r.kind === "weekly" && r.weekday === weekday)?.intervals ?? [];
}

/**
 * Bookable slot starts (UTC) for one event type. Pure: same input, same output.
 * Availability is expanded per calendar date in the schedule's zone, so daylight-saving changes there
 * move the UTC times and never the host's wall-clock hours.
 */
export function computeSlots(input: SlotInput): Date[] {
  return computeSlotSeats(input).map((s) => s.start);
}

/**
 * computeSlots with each start's seats left: null for a one-on-one type. A group class time stays open while it has a
 * free seat: its own seats, and the host's calendar event for it (exactly the class's time), don't block it.
 */
export function computeSlotSeats(input: SlotInput): { start: Date; seatsLeft: number | null }[] {
  const { eventType: et, schedule, rules, busyBlocks, bookings, now, rangeStart, rangeEnd, syncStale } = input;
  if (syncStale) return [];

  const tz = schedule.timezone;
  const duration = et.durationMinutes * MIN;
  const step = et.startIncrementMinutes * MIN;
  const before = et.bufferBeforeMinutes * MIN;
  const after = et.bufferAfterMinutes * MIN;
  const earliest = Math.max(rangeStart.getTime(), now.getTime() + et.minNoticeMinutes * MIN);
  const latest = Math.min(rangeEnd.getTime(), now.getTime() + et.bookingWindowDays * DAY);
  if (earliest >= latest) return [];

  // A hold the guest is still paying for blocks like a confirmed booking; a lapsed one is about to be expired and doesn't.
  const confirmed = bookings.filter((b) => b.status === "confirmed" || (b.status === "pending_payment" && b.holdExpiresAt !== null && b.holdExpiresAt > now));
  const ownSeat = new Set(confirmed.filter((b) => b.eventTypeId === et.id && b.classKey).map((b) => `${b.bufferedStart.getTime()}:${b.bufferedEnd.getTime()}`));
  const blocked: [number, number][] = [
    ...confirmed.map((b): [number, number] => [b.bufferedStart.getTime(), b.bufferedEnd.getTime()]),
    ...busyBlocks.map((b): [number, number] => [b.start.getTime(), b.end.getTime()]),
  ];
  const seatLimit = et.seatLimit ?? null;
  const seatsTaken = new Map<number, number>(); // class start -> seats taken, for this group type
  const counted = new Set<string>();
  const bookedPerDay = new Map<number, number>();
  const bookedPerWeek = new Map<number, number>();
  for (const b of confirmed) {
    if (b.eventTypeId !== et.id) continue;
    if (b.classKey) {
      seatsTaken.set(b.startAt.getTime(), (seatsTaken.get(b.startAt.getTime()) ?? 0) + 1);
      if (counted.has(b.classKey)) continue; // a class counts once towards the limits
      counted.add(b.classKey);
    }
    const day = localDay(b.startAt, tz);
    bookedPerDay.set(day, (bookedPerDay.get(day) ?? 0) + 1);
    bookedPerWeek.set(weekOf(day), (bookedPerWeek.get(weekOf(day)) ?? 0) + 1);
  }

  const slots: { start: Date; seatsLeft: number | null }[] = [];
  const lastDay = localDay(new Date(latest), tz);
  for (let day = localDay(new Date(earliest), tz); day <= lastDay; day += DAY) {
    // A full day or week takes no new session; a group class already on it still takes guests.
    const full = (et.dailyLimit != null && (bookedPerDay.get(day) ?? 0) >= et.dailyLimit)
      || (et.weeklyLimit != null && (bookedPerWeek.get(weekOf(day)) ?? 0) >= et.weeklyLimit);
    if (full && seatLimit === null) continue;
    for (const { from, to } of intervalsFor(day, rules)) {
      const open = wallTime(day, minutesOf(from), tz);
      const close = wallTime(day, minutesOf(to), tz);
      for (let start = open; start + duration <= close; start += step) {
        if (start < earliest || start >= latest) continue;
        const bufStart = start - before;
        const bufEnd = start + duration + after;
        const taken = seatLimit === null ? 0 : seatsTaken.get(start) ?? 0;
        if ((seatLimit !== null && taken >= seatLimit) || (full && taken === 0)) continue;
        // A class already running at this start: its seats and its calendar event are this class, not a clash.
        const own = (s: number, e: number) => taken > 0 && ((s === start && e === start + duration) || ownSeat.has(`${s}:${e}`));
        if (blocked.some(([s, e]) => !own(s, e) && overlaps(bufStart, bufEnd, s, e))) continue;
        slots.push({ start: new Date(start), seatsLeft: seatLimit === null ? null : seatLimit - taken });
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface OneOffSlotInput {
  /** The start times the host offered. */
  times: Date[];
  durationMinutes: number;
  busyBlocks: Range[];
  bookings: SlotInput["bookings"];
  now: Date;
  rangeStart: Date;
  rangeEnd: Date;
  syncStale: boolean;
}

/**
 * Free times for a one-off meeting: the offered times still in the future and inside the range that clash with nothing
 * (busy calendar time, a confirmed booking, or a payment hold still running). No buffers, notice or working hours: the
 * host picked these times by hand. A stale calendar offers nothing, as for every other event type.
 */
export function computeOneOffSlots(input: OneOffSlotInput): Date[] {
  const { times, durationMinutes, busyBlocks, bookings, now, rangeStart, rangeEnd, syncStale } = input;
  if (syncStale) return [];
  const duration = durationMinutes * MIN;
  const live = bookings.filter((b) => b.status === "confirmed" || (b.status === "pending_payment" && b.holdExpiresAt !== null && b.holdExpiresAt > now));
  const blocked: [number, number][] = [
    ...live.map((b): [number, number] => [b.bufferedStart.getTime(), b.bufferedEnd.getTime()]),
    ...busyBlocks.map((b): [number, number] => [b.start.getTime(), b.end.getTime()]),
  ];
  return times
    .filter((t) => t.getTime() > now.getTime() && t >= rangeStart && t < rangeEnd)
    .filter((t) => !blocked.some(([s, e]) => overlaps(t.getTime(), t.getTime() + duration, s, e)))
    .sort((a, b) => a.getTime() - b.getTime());
}
