"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clockLabel, panelOpacities } from "./day-clock";
import { useScrollProgress } from "./useScrollProgress";

type Panel = { from: string; title: string; body: string };

const fmt = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * §3.6 Day-to-night. Pinned for 240% of a screen of scroll (wrapper = 340svh),
 * clock 12:00 PM → 1:00 AM, sky amber → blue, panels cross-fade, progress rail.
 * Without JS or with reduced motion the panels simply stack.
 */
export function DayClock({ panels }: { panels: readonly Panel[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pinned, setPinned] = useState(false);
  const [label, setLabel] = useState("12:00 PM");
  const froms = panels.map((p) => p.from);

  useEffect(() => {
    setPinned(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const onProgress = useCallback(
    (p: number) => {
      if (!pinned) return;
      setLabel(clockLabel(p));
      panelOpacities(p, froms).forEach((o, i) => {
        const el = panelRefs.current[i];
        if (el) {
          el.style.opacity = o.toFixed(3);
          el.setAttribute("aria-hidden", o < 0.5 ? "true" : "false");
        }
      });
    },
    // froms is derived from static content
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinned],
  );
  useScrollProgress(wrapRef, "--dp", "sticky", onProgress);

  if (!pinned) {
    return (
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-24 md:grid-cols-3 md:px-8">
        {panels.map((p) => (
          <div key={p.title} className="rounded-2xl border border-line bg-surface p-6">
            <p className="font-display text-4xl tracking-[-0.05em] text-amber">{fmt(p.from)}</p>
            <h3 className="mt-3 font-display text-2xl tracking-[-0.04em]">{p.title}</h3>
            <p className="mt-2 text-muted">{p.body}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-[340svh]">
      <div className="sticky top-0 flex h-svh flex-col items-center justify-center overflow-hidden px-4 text-center">
        <div className="hydra-sky-day absolute inset-0 -z-10" style={{ opacity: "calc(1 - var(--dp, 0))" }} aria-hidden="true" />
        <div className="hydra-sky-night absolute inset-0 -z-10" style={{ opacity: "var(--dp, 0)" }} aria-hidden="true" />
        <p className="font-display text-[clamp(4rem,17vw,13rem)] leading-none tracking-[-0.06em] tabular-nums" aria-live="off">
          {label}
        </p>
        <div className="relative mt-8 h-40 w-full max-w-xl">
          {panels.map((p, i) => (
            <div
              key={p.title}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              className="absolute inset-0 transition-opacity duration-200"
              style={{ opacity: i === 0 ? 1 : 0 }}
              aria-hidden={i !== 0}
            >
              <h3 className="font-display text-[clamp(1.8rem,5vw,3rem)] tracking-[-0.05em]">{p.title}</h3>
              <p className="mx-auto mt-2 max-w-md text-text/85">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-6 bottom-10 mx-auto h-1 max-w-xl overflow-hidden rounded-full bg-white/10 md:inset-x-0" aria-hidden="true">
          <div className="h-full origin-left bg-amber" style={{ transform: "scaleX(var(--dp, 0))" }} />
        </div>
      </div>
    </div>
  );
}
