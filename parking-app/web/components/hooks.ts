"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Session } from "@/lib/contract";
import { getSession, onSessionChange } from "@/lib/session";

/** Current session, or null. Null during server render, so pages render the signed-out state first. */
export function useSession(): Session | null {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => { setS(getSession()); return onSessionChange(() => setS(getSession())); }, []);
  return s;
}

/** True once the component has mounted in the browser. */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

const subscribe = (f: () => void) => {
  window.addEventListener("online", f); window.addEventListener("offline", f);
  return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
};
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Re-renders every `ms` so relative times ("ends in 12 min") stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
