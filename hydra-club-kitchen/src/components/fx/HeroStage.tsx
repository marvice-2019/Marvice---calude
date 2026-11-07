"use client";

import { useEffect, useRef, useState } from "react";
import { HERO_SCENE_MS, HERO_SCENES } from "@/content/site";
import { useScrollProgress } from "./useScrollProgress";

/**
 * Hero behaviour around server-rendered scenes: auto-advance every 5.6 s (chips
 * with a fill bar; paused under reduced motion), pointer parallax, and the
 * scroll pin (--hp 0..1 drives the zoom, the wordmark and the emblem in CSS).
 */
export function HeroStage({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);

  useScrollProgress(rootRef, "--hp", "sticky");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAuto(!reduce);
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (reduce || !fine) return;
    const el = rootRef.current!;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty("--px", ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
        el.style.setProperty("--py", ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div ref={rootRef} data-active={active} className="hydra-hero relative h-[195svh] motion-reduce:h-auto">
      <div className="sticky top-0 h-svh overflow-hidden motion-reduce:relative">
        {children}
        <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center gap-2 px-4" role="group" aria-label="Scenes">
          {HERO_SCENES.map((s, i) => (
            <button
              key={s.tag}
              type="button"
              aria-pressed={active === i}
              onClick={() => {
                setActive(i);
                setAuto(false);
              }}
              className="relative min-h-11 min-w-[4.5rem] overflow-hidden rounded-full border border-line bg-bg/40 px-3 text-xs backdrop-blur aria-pressed:border-text"
            >
              <span
                key={`${active}-${auto}`}
                className={`absolute inset-y-0 left-0 bg-aqua/25 ${active === i && auto ? "motion-safe:animate-[hydra-fill_var(--scene-ms)_linear_forwards]" : active === i ? "w-full" : "w-0"}`}
                style={{ "--scene-ms": `${HERO_SCENE_MS}ms` } as React.CSSProperties}
                onAnimationEnd={() => auto && setActive((a) => (a + 1) % HERO_SCENES.length)}
                aria-hidden="true"
              />
              <span className="relative">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
