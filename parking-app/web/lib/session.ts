import type { Session } from "./contract";

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
export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
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
