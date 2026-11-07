"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Toast = { kind: "ok" | "error"; text: string } | null;
const ToastCtx = createContext<(t: Toast) => void>(() => {});

/** Plain-language toasts for admin actions, announced to screen readers. */
export function AdminToasts({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={setToast}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6">
        {toast && (
          <p className={`rounded-xl px-4 py-3 text-sm shadow-lg ${toast.kind === "ok" ? "bg-[#103b2e] text-[#9ff0d3]" : "bg-[#4a1515] text-[#ffc2c2]"}`}>{toast.text}</p>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

/**
 * Sends an admin mutation to /api/admin/* (same origin, so the CSRF origin
 * check passes), shows the result, and refreshes the server data.
 */
export function useAdminAction() {
  const router = useRouter();
  const toast = useContext(ToastCtx);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown, okText = "Saved.") => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string } & Record<string, unknown>;
        if (!res.ok || data.ok === false) {
          toast({ kind: "error", text: data.message ?? (res.status === 403 ? "You don't have access to that." : "That didn't work. Try again.") });
          return null;
        }
        toast({ kind: "ok", text: okText });
        router.refresh();
        return data;
      } catch {
        toast({ kind: "error", text: "No connection. Check the Wi-Fi and try again." });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [router, toast],
  );
  return { run, busy };
}

/** Re-fetches the page's server data every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => !document.hidden && router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

const ACTIONS = {
  confirm: { label: "Confirm", from: ["pending"], danger: false },
  complete: { label: "Seated / done", from: ["confirmed"], danger: false },
  no_show: { label: "No-show", from: ["pending", "confirmed"], danger: true },
  cancel: { label: "Cancel", from: ["pending", "confirmed"], danger: true },
} as const;

/** Status buttons for one booking; destructive ones ask first. */
export function BookingActions({ id, status, label }: { id: string; status: string; label: string }) {
  const { run, busy } = useAdminAction();
  const available = (Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).filter((a) => (ACTIONS[a].from as readonly string[]).includes(status));
  if (available.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {available.map((a) => (
        <button
          key={a}
          type="button"
          disabled={busy}
          onClick={() => {
            if (ACTIONS[a].danger && !window.confirm(`${ACTIONS[a].label}: ${label}?`)) return;
            void run("PATCH", "/api/admin/bookings", { id, action: a }, `${ACTIONS[a].label}: done.`);
          }}
          className={`min-h-11 rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${
            ACTIONS[a].danger ? "border border-line text-[#ffb4b4]" : "bg-aqua text-on-aqua"
          }`}
        >
          {ACTIONS[a].label}
        </button>
      ))}
    </div>
  );
}
