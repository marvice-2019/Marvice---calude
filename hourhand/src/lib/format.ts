/** Short name for a zone: "IST" for Asia/Kolkata, otherwise the IANA name with spaces. */
export function zoneName(tz: string): string {
  return tz === "Asia/Kolkata" ? "IST" : tz.replaceAll("_", " ");
}

export type HourCycle = "12h" | "24h";

/** "3:30 pm" in `tz`, or "15:30" with the 24h cycle. */
export function formatTime(date: Date, tz: string, cycle: HourCycle = "12h"): string {
  if (cycle === "24h") return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toLowerCase();
}

/** "Tuesday, 20 October 2026" in `tz`. */
export function formatDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** Calendar date of an instant in `tz`, as "YYYY-MM-DD". */
export function dayKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
