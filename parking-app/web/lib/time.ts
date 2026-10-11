// Arrival presets the way people plan in India: now, an hour from now, this evening, tomorrow morning (IST).
const IST_OFFSET_MIN = 330;

/** Round up to the next quarter hour, so quotes don't change every minute. */
export function nextQuarter(d = new Date()) {
  const q = 15 * 60_000;
  return new Date(Math.ceil(d.getTime() / q) * q);
}

/** A wall-clock time in India today (or tomorrow if `dayOffset`), as a Date. */
export function istAt(hour: number, dayOffset = 0, now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const utc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, hour, 0) - IST_OFFSET_MIN * 60_000;
  return new Date(utc);
}

export type Preset = { id: string; label: string; at: () => Date };
export const ARRIVALS: Preset[] = [
  { id: "now", label: "Now", at: () => nextQuarter() },
  { id: "1h", label: "In 1 hour", at: () => nextQuarter(new Date(Date.now() + 3_600_000)) },
  { id: "eve", label: "This evening", at: () => { const t = istAt(18); return t > new Date() ? t : istAt(18, 1); } },
  { id: "tmrw", label: "Tomorrow 9 am", at: () => istAt(9, 1) }
];
export const DURATIONS = [1, 2, 3, 4, 8, 24];

/** Value for <input type="datetime-local"> in IST. */
export function toLocalInput(d: Date) {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}
export function fromLocalInput(s: string) {
  return new Date(new Date(s + ":00Z").getTime() - IST_OFFSET_MIN * 60_000);
}

export function rangeQuery(from: Date, hours: number, vehicle: string) {
  const to = new Date(from.getTime() + hours * 3_600_000);
  return new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), vehicle }).toString();
}
