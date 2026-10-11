import type { Booking, Session } from "./contract";

// Session lives in localStorage: a 15-minute access token plus a rotating 30-day refresh token (SPEC §8).
const KEY = "bayline.session";
const listeners = new Set<() => void>();

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
export function setSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: session lasts this tab only */ }
  listeners.forEach(f => f());
}
/** Signs out and removes everything this app stored on the device (passes, phone, plate), for shared devices and DPDP erasure. */
export function clearSession() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("bayline.")) localStorage.removeItem(k);
  } catch { /* ignore */ }
  listeners.forEach(f => f());
}
export function onSessionChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Small per-device conveniences (search area, last plate) — never anything the server must trust. */
export function local<T>(key: string, value?: T): T | null {
  if (typeof window === "undefined") return null;
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem("bayline." + key) ?? "null");
    localStorage.setItem("bayline." + key, JSON.stringify(value));
    return value;
  } catch { return null; }
}

/** Offline copy of a user's passes. Read back only for the same user, so another account never sees them. */
export function cachePasses(userId: string, list: Booking[]) { local("passes", { userId, list }); }
export function cachedPasses(userId: string | undefined): Booking[] | null {
  const c = local<{ userId: string; list: Booking[] }>("passes");
  return c && userId && c.userId === userId ? c.list : null;
}
