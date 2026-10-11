import type { HourCycle } from "@/lib/format";

/** The cycle to show: a valid stored choice wins, otherwise the locale's own hour cycle. */
export function resolveCycle(stored: string | null | undefined, localeHourCycle: string | undefined): HourCycle {
  if (stored === "12h" || stored === "24h") return stored;
  return localeHourCycle === "h23" || localeHourCycle === "h24" ? "24h" : "12h";
}
