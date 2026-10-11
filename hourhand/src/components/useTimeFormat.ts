"use client";

import { useSyncExternalStore } from "react";
import type { HourCycle } from "@/lib/format";
import { resolveCycle } from "@/lib/time-format";

const CYCLE_KEY = "hourhand.timeFormat";
const cycleListeners = new Set<() => void>();
let cycleOverride: HourCycle | null = null; // keeps the choice for this visit when storage is unavailable

function readCycle(): HourCycle {
  if (cycleOverride) return cycleOverride;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(CYCLE_KEY);
  } catch {
    // Storage blocked: fall back to the locale default.
  }
  return resolveCycle(stored, new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle);
}

/** Remember the guest's 12h/24h choice and tell every mounted reader. */
export function setTimeFormat(cycle: HourCycle) {
  cycleOverride = cycle;
  try {
    localStorage.setItem(CYCLE_KEY, cycle);
  } catch {
    // Storage blocked: the choice still holds for this visit.
  }
  cycleListeners.forEach((l) => l());
}

function subscribeCycle(listener: () => void) {
  cycleListeners.add(listener);
  return () => { cycleListeners.delete(listener); };
}

/** The guest's 12h/24h choice. The server and the first client render both see 12h, so hydration matches. */
export function useTimeFormat(): HourCycle {
  return useSyncExternalStore(subscribeCycle, readCycle, () => "12h" as const);
}
