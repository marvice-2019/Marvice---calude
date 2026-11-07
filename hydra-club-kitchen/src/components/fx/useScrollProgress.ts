"use client";

import { useEffect, type RefObject } from "react";

export type ProgressMode =
  /** Pinned section: 0 when its top reaches the viewport top, 1 when its bottom reaches the viewport bottom. */
  | "sticky"
  /** Passing section: 0 as it enters from below, 1 once it is well into view. */
  | "pass";

/**
 * Writes scroll progress (0..1) to a CSS variable on the element, once per
 * animation frame while scrolling. Optional callback for JS-driven bits.
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  cssVar: string,
  mode: ProgressMode,
  onProgress?: (p: number) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const raw = mode === "sticky" ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / Math.max(1, r.height * 0.9 + vh * 0.35);
      const p = Math.min(1, Math.max(0, raw));
      el.style.setProperty(cssVar, p.toFixed(4));
      onProgress?.(p);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, cssVar, mode, onProgress]);
}

/** True when the visitor asked for reduced motion (read once on mount). */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
