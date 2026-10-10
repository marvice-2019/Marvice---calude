"use client";

import { formatTime } from "@/lib/format";
import { useTimeFormat } from "./useTimeFormat";

/** A time of day in `tz`, in the 12h or 24h cycle the guest chose. */
export function LocalTime({ date, tz }: { date: Date | string; tz: string }) {
  return <>{formatTime(new Date(date), tz, useTimeFormat())}</>;
}
