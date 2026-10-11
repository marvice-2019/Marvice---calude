"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/Button";

/** Copies the full booking URL for a path like "/priya/coaching" and says "Copied" for 2 seconds. */
export function CopyLinkButton({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={copy}>
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy link"}</span>
    </Button>
  );
}
