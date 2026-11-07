"use client";

import { useRef } from "react";
import { useScrollProgress, type ProgressMode } from "./useScrollProgress";

/** Wraps server markup and writes its scroll progress to a CSS variable (e.g. the story's word reveal). */
export function ProgressVar({ cssVar, mode, className, children }: { cssVar: string; mode: ProgressMode; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollProgress(ref, cssVar, mode);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
