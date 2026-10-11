"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the page every few seconds for a while, so a status that changes on the server (a payment confirming) shows up. */
export function AutoRefresh({ everyMs = 4000, forMs = 180_000 }: { everyMs?: number; forMs?: number }) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > forMs) { clearInterval(t); setStopped(true); }
      else router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, forMs]);
  // Say plainly when it has stopped checking, rather than leaving the page looking live.
  return (
    <p className="mt-2 text-sm text-text-muted" role="status">
      {stopped ? "Still waiting? Refresh this page in a minute." : "This page updates by itself."}
    </p>
  );
}
