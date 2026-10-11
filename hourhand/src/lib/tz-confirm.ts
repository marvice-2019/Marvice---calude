import { formatTime, zoneName, type HourCycle } from "./format";

export interface ZoneCheck {
  /** The guest is looking at times in a zone other than their device's: ask them to confirm where they'll be. */
  confirm: boolean;
  /** "10:00 am IST for Priya": the same moment on the host's clock, when the host is in a different zone. */
  hostLine: string | null;
}

/**
 * A wrong zone is the usual cause of a missed meeting. When the guest picked a zone that isn't their device's, the
 * booking form makes them confirm it; when the host is elsewhere, it shows the host's time too. No device zone (old
 * browser) means nothing to compare, so no confirm step.
 */
export function zoneCheck(slot: Date, viewing: string, device: string | null, host: { name: string; timezone: string }, cycle: HourCycle = "12h"): ZoneCheck {
  const firstName = host.name.split(/\s+/)[0] || host.name;
  return {
    confirm: device !== null && !sameZone(viewing, device, slot),
    hostLine: sameZone(viewing, host.timezone, slot) ? null : `${formatTime(slot, host.timezone, cycle)} ${zoneName(host.timezone)} for ${firstName}`,
  };
}

/** Two zone names that read the same wall-clock time at this moment (Asia/Calcutta and Asia/Kolkata) count as one. */
function sameZone(a: string, b: string, at: Date): boolean {
  if (a === b) return true;
  try {
    const f = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    return f(a) === f(b);
  } catch {
    return false;
  }
}
