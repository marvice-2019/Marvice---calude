"use client";

import { useEffect, useRef } from "react";
import { beatLevel, isSoundOn } from "@/lib/beat";
import { on } from "@/lib/site-events";

/**
 * Page-wide effects: cursor spotlight (fine pointers only), grain overlay,
 * white flash on Drop (at most once a second: WCAG 2.3.1 allows 3 flashes/s),
 * and --beat on the hero while the sound plays.
 */
export function GlobalFx() {
  const spotRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const offs: (() => void)[] = [];

    if (fine && !reduce && spotRef.current) {
      const spot = spotRef.current;
      let raf = 0;
      let x = 0;
      let y = 0;
      const onMove = (e: PointerEvent) => {
        x = e.clientX;
        y = e.clientY;
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0;
            spot.style.setProperty("--mx", `${x}px`);
            spot.style.setProperty("--my", `${y}px`);
            spot.dataset.on = "true";
          });
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      offs.push(() => window.removeEventListener("pointermove", onMove));
    }

    let lastFlash = 0;
    offs.push(
      on("hydra:drop", () => {
        const now = performance.now();
        if (reduce || now - lastFlash < 1000 || !flashRef.current) return;
        lastFlash = now;
        const el = flashRef.current;
        el.dataset.flash = "false";
        void el.offsetWidth; // restart the CSS transition
        el.dataset.flash = "true";
      }),
    );

    // Kick-driven glow on the hero emblem while the sound plays.
    let beatRaf = 0;
    const beatLoop = () => {
      const hero = document.getElementById("top");
      if (!isSoundOn()) {
        hero?.style.setProperty("--beat", "0");
        beatRaf = 0;
        return;
      }
      hero?.style.setProperty("--beat", beatLevel(performance.now()).toFixed(3));
      beatRaf = requestAnimationFrame(beatLoop);
    };
    offs.push(
      on("hydra:sound", ({ on: playing }) => {
        if (playing && !beatRaf && !reduce) beatRaf = requestAnimationFrame(beatLoop);
      }),
    );

    return () => {
      offs.forEach((f) => f());
      if (beatRaf) cancelAnimationFrame(beatRaf);
    };
  }, []);

  return (
    <>
      <div ref={spotRef} className="hydra-spotlight" aria-hidden="true" />
      <div className="hydra-grain" aria-hidden="true" />
      <div ref={flashRef} className="hydra-flash" data-flash="false" aria-hidden="true" />
    </>
  );
}
