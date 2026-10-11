import { TZDate } from "@date-fns/tz";
import type pg from "pg";

// The waitlist: guests waiting for a time on a day that was full. Freed times reach them through the job queue.

type Db = Pick<pg.PoolClient, "query">;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

export type WaitlistInput = { day: string; timezone: string; name: string; email: string };

/** A day as the guest saw it, in their zone: [start, next day's start). Null for a date that doesn't exist. */
export function dayWindow(day: string, timezone: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let start: TZDate;
  try {
    start = new TZDate(y, mo - 1, d, 0, 0, 0, timezone);
  } catch {
    return null;
  }
  if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) return null;
  const next = new TZDate(y, mo - 1, d + 1, 0, 0, 0, timezone);
  return { start: new Date(start.getTime()), end: new Date(next.getTime()) };
}

/** Checks what a guest sends; the day must be today or later and within the event's booking window. */
export function validateWaitlist(input: Record<string, unknown>, now: Date, bookingWindowDays: number, isZone: (tz: unknown) => tz is string):
  { ok: true; value: WaitlistInput & { window: { start: Date; end: Date } } } | { ok: false; fields: Record<string, string> } {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  const fields: Record<string, string> = {};
  const name = str("name"), email = str("email"), day = str("day");
  if (name.length < 1 || name.length > 100) fields.name = "Enter your name (up to 100 characters).";
  if (!EMAIL.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  const timezone = isZone(input.timezone) ? input.timezone : null;
  if (!timezone) fields.timezone = "Pick a valid time zone.";
  const window = timezone ? dayWindow(day, timezone) : null;
  if (!window) fields.day = "Pick a day.";
  else if (window.end <= now || window.start.getTime() > now.getTime() + bookingWindowDays * DAY_MS) fields.day = "Pick a day you could still book.";
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { day, timezone: timezone!, name, email, window: window! } };
}

/** Joins an address may make in a rolling week, across every host: anyone can type any email, so this bounds what a stranger can be sent. */
export const WAITLIST_JOINS_PER_WEEK = 5;

/**
 * Adds the guest to the event type's waitlist for that day; joining twice keeps one entry (and their newest name).
 * False when the address has used up its joins for the week.
 */
export async function joinWaitlist(db: Db, hostId: string, eventTypeId: string, v: WaitlistInput & { window: { start: Date; end: Date } }, now = new Date()): Promise<boolean> {
  const { rows: [c] } = await db.query(
    "select count(*)::int as n, bool_or(event_type_id = $2 and day = $3) as same from waitlist where email = $1 and created_at > $4",
    [v.email, eventTypeId, v.day, new Date(now.getTime() - 7 * DAY_MS)]);
  if (c.n >= WAITLIST_JOINS_PER_WEEK && !c.same) return false;
  await db.query(
    `insert into waitlist (host_id, event_type_id, day, timezone, window_start, window_end, name, email, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (event_type_id, day, email) do update set name = excluded.name`,
    [hostId, eventTypeId, v.day, v.timezone, v.window.start, v.window.end, v.name, v.email, now]);
  return true;
}

/**
 * Inside the transaction that frees a booking's time (a cancel, or a move away): queues one email for each guest
 * still waiting on that day for that event type, and marks them notified so they hear once. Only for a time still ahead.
 */
export async function queueWaitlistFor(db: Db, bookingId: string, now: Date): Promise<number> {
  const { rows } = await db.query(
    `with freed as (select id, event_type_id, host_id, start_at from bookings where id = $1 and start_at > $2),
     picked as (
       update waitlist w set notified_at = $2 from freed f
       where w.event_type_id = f.event_type_id and w.notified_at is null and f.start_at >= w.window_start and f.start_at < w.window_end
       returning w.id, w.email, f.host_id, f.id as booking_id)
     insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
     select p.booking_id, p.host_id, 'email', 'waitlist_guest', p.email, $2, 'waitlist:' || p.id
     from picked p on conflict (dedupe_key) do nothing returning id`, [bookingId, now]);
  return rows.length;
}

/** Guests' emails are kept only while their day can still open up: a day after it ends, the entry goes. */
export async function pruneWaitlist(db: Db, now: Date): Promise<number> {
  const { rowCount } = await db.query("delete from waitlist where window_end < $1", [new Date(now.getTime() - DAY_MS)]);
  return rowCount ?? 0;
}
