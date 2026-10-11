export const rupees = (paise: number) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

const IST = "Asia/Kolkata";
export const when = (iso: string | Date) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const clock = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });

export const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export function relative(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000)), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Greeting by India time, used in the hero. */
export function greeting(d = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", hourCycle: "h23" }).format(d));
  return h < 5 ? "Late night drive?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export const PLATE = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/;
export const cleanPlate = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();
export const PHONE = /^[6-9]\d{9}$/;
