"use client";

import { useEffect, useRef } from "react";

/** Speeds the marquee's CSS animation up with scroll velocity, easing back to normal. */
export function MarqueeSpeed({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let lastY = window.scrollY;
    let lastT = performance.now();
    let rate = 1;
    let raf = 0;
    const tick = () => {
      rate += (1 - rate) * 0.06;
      for (const a of ref.current?.getAnimations({ subtree: true }) ?? []) a.playbackRate = rate;
      raf = Math.abs(rate - 1) > 0.01 ? requestAnimationFrame(tick) : 0;
    };
    const onScroll = () => {
      const now = performance.now();
      const v = Math.abs(window.scrollY - lastY) / Math.max(1, now - lastT); // px per ms
      lastY = window.scrollY;
      lastT = now;
      rate = Math.max(rate, Math.min(5, 1 + v * 2.5));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}
