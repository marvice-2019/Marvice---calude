// Display helpers. All money arrives in paise (integers) from the API; only formatting happens here.

export function inr(paise: number): string {
  const whole = paise % 100 === 0;
  return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

const IST = "Asia/Kolkata";
export function when(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function clock(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
}
export function km(m: number): string { return (m / 1000).toFixed(1) + " km"; }

export function rel(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

/** Value for <input type="datetime-local"> in India time, and back to an ISO instant. */
export function toLocalInput(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(v + ":00+05:30");
  return isNaN(d.getTime()) ? null : d;
}

/** Next whole hour from now, and +3 h: the default search window (same as the prototype). */
export function defaultWindow(now = Date.now()): { from: Date; to: Date } {
  const from = new Date(Math.ceil((now + 1) / 3_600_000) * 3_600_000);
  return { from, to: new Date(from.getTime() + 3 * 3_600_000) };
}

export const KIND_LABEL: Record<string, string> = {
  multilevel: "Multilevel", basement: "Basement", surface: "Open surface", covered_deck: "Covered deck", owner_listed: "Owner-listed"
};
export function timings(l: { open_24h: boolean; opens_at: string | null; closes_at: string | null }): string {
  if (l.open_24h) return "Open 24 hours";
  if (!l.opens_at || !l.closes_at) return "Timings on site";
  return `${l.opens_at.slice(0, 5)}–${l.closes_at.slice(0, 5)}`;
}

export const PLATE_RE = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/;
export const normPlate = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();
export const PHONE_RE = /^[6-9]\d{9}$/;
export const PLATE_ERR = "Enter a valid number plate, for example KA 01 AB 1234 or 22 BH 1234 AB.";
export const PHONE_ERR = "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";
