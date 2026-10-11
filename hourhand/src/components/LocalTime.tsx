"use client";

import { formatTime } from "@/lib/format";
import { useTimeFormat } from "./useTimeFormat";
import type { Locale } from "@/lib/i18n/guest";

/** A time of day in `tz`, in the 12h or 24h cycle the guest chose. */
export function LocalTime({ date, tz, locale = "en" }: { date: Date | string; tz: string; locale?: Locale }) {
  return <>{formatTime(new Date(date), tz, useTimeFormat(), locale)}</>;
}
