import { TZDate } from "@date-fns/tz";

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The start times a host typed for a one-off meeting ("2026-10-20T15:30", from datetime-local inputs) as instants in
 * the host's time zone. Blank rows are skipped; a row that isn't a real date and time is an error naming its position.
 */
export function parseLocalTimes(values: string[], timeZone: string): { ok: true; times: Date[] } | { ok: false; error: string } {
  const times: Date[] = [];
  for (const [i, raw] of values.entries()) {
    const v = raw.trim();
    if (!v) continue;
    const m = LOCAL.exec(v);
    if (!m) return { ok: false, error: `Time ${i + 1} isn't a date and time.` };
    const [, y, mo, d, h, mi] = m.map(Number);
    const at = new TZDate(y, mo - 1, d, h, mi, 0, timeZone);
    // TZDate rolls an impossible date (31 Feb) forward; refuse it rather than offering a day the host didn't pick.
    if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) return { ok: false, error: `Time ${i + 1} isn't a real date.` };
    // A clock-change gap (02:30 on a spring-forward day) rolls forward too; say so rather than offering another time.
    if (at.getHours() !== h || at.getMinutes() !== mi) return { ok: false, error: `Time ${i + 1} doesn't exist that day: the clocks change. Pick another time.` };
    times.push(new Date(at.getTime()));
  }
  return { ok: true, times };
}
