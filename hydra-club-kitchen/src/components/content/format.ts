import { bookableDates, WEEKDAYS, weekdayOf, type WeekHours } from "@/booking/time";

/** Paise → "₹1,250" (en-IN grouping, paise shown only when not whole rupees). */
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "23:30" → "11:30 PM", "01:00" → "1 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const DISPLAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SHORT: Record<(typeof DISPLAY_ORDER)[number], string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

/**
 * Opening hours as display lines, Monday first, consecutive identical days
 * collapsed. Seven identical days → "Open every day · 11:30 AM – 1 AM".
 * Unconfirmed hours (null) → [] so the UI hides the row.
 */
export function hoursSummary(hours: WeekHours | null): string[] {
  if (!hours) return [];
  const label = (d: (typeof DISPLAY_ORDER)[number]) => {
    const h = hours[d];
    return h ? `${formatTime(h.open)} – ${formatTime(h.close)}` : "Closed";
  };
  const groups: { from: string; to: string; text: string }[] = [];
  for (const d of DISPLAY_ORDER) {
    const text = label(d);
    const last = groups.at(-1);
    if (last && last.text === text) last.to = SHORT[d];
    else groups.push({ from: SHORT[d], to: SHORT[d], text });
  }
  if (groups.length === 1) return groups[0]!.text === "Closed" ? [] : [`Open every day · ${groups[0]!.text}`];
  return groups.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} · ${g.text}`);
}

/**
 * First bookable service date (Asia/Kolkata, 05:00 cutoff) whose ISO weekday
 * (Mon=1 … Sun=7) is in `rule` ("5,6"). Null when the rule is empty, malformed,
 * or no matching night falls inside the booking window.
 */
export function nextNightDate(rule: string, now: Date, windowDays: number): string | null {
  const iso = new Set(rule.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7));
  if (iso.size === 0) return null;
  return bookableDates(now, windowDays).find((d) => iso.has(WEEKDAYS.indexOf(weekdayOf(d)) || 7)) ?? null;
}

export type Stat = { value: number; label: string; prefix?: string; suffix?: string };
type NumbersInput = {
  totalTables: number;
  zones: { key: string; tableCount: number }[];
  hours: WeekHours | null;
  costForTwoInr: number | null;
};

/** Count-up stats, every one derived from the database. A stat with no true value is dropped. */
export function numbersFor(d: NumbersInput): Stat[] {
  const stats: Stat[] = [];
  if (d.totalTables > 0) stats.push({ value: d.totalTables, label: "Tables to book" });
  const zonesWithTables = d.zones.filter((z) => z.tableCount > 0).length;
  if (zonesWithTables > 1) stats.push({ value: zonesWithTables, label: "Zones on the floor" });
  const vip = d.zones.filter((z) => z.key === "vip" || z.key === "vvip").reduce((n, z) => n + z.tableCount, 0);
  if (vip > 0) stats.push({ value: vip, label: "VIP & VVIP tables" });
  const openDays = d.hours ? WEEKDAYS.filter((w) => d.hours![w] !== null).length : 0;
  if (openDays > 0) stats.push({ value: openDays, label: openDays === 7 ? "Nights a week" : "Nights open a week" });
  if (d.costForTwoInr) stats.push({ value: d.costForTwoInr, prefix: "₹", label: "About, for two" });
  return stats;
}
