"use client";

import { useEffect } from "react";
import { focusRing } from "@/components/ui/focus";

/** After a booking, the host's own page: a few seconds to read the confirmation first, and a link if the move is blocked. */
export function AutoRedirect({ url, label, waiting, seconds = 5 }: { url: string; label: string; waiting: string; seconds?: number }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.assign(url), seconds * 1000);
    return () => clearTimeout(t);
  }, [url, seconds]);
  return (
    <p className="mt-4 text-text-muted" role="status">
      {waiting}{" "}
      <a href={url} rel="noopener" className={`font-semibold text-accent underline ${focusRing}`}>{label}</a>
    </p>
  );
}
