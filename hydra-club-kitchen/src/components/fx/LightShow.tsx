"use client";

import { useEffect, useRef, useState } from "react";
import { LIGHT_MODES } from "@/content/site";
import type { LightRenderer } from "@/lib/light/renderer";
import { on } from "@/lib/site-events";

type Mode = keyof typeof LIGHT_MODES;

function currentMode(): Mode {
  const m = document.documentElement.dataset.lightMode as Mode | undefined;
  return m && m in LIGHT_MODES ? m : "hydra";
}

/**
 * Canvas for the WebGL light show with CSS beams underneath. The renderer is
 * imported only after first paint (interactive canvases: once near the
 * viewport). data-gl: pending → on (beams hidden) or off (beams stay).
 */
export function LightShow({
  id,
  interactive = false,
  shockOnTap = false,
  className = "",
}: {
  id: "fx" | "fx2";
  interactive?: boolean;
  shockOnTap?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gl, setGl] = useState<"pending" | "on" | "off">("pending");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: LightRenderer | null = null;
    let cancelled = false;
    const offs: (() => void)[] = [];

    const load = () =>
      import("@/lib/light/renderer").then(({ createLightRenderer }) => {
        if (cancelled) return;
        renderer = createLightRenderer(canvas, { interactive, onLost: () => setGl("off") });
        if (!renderer) {
          setGl("off");
          return;
        }
        renderer.setPalette(LIGHT_MODES[currentMode()].colours);
        setGl("on");
        offs.push(on("hydra:mode", ({ mode }) => renderer?.setPalette(LIGHT_MODES[mode].colours)));
        offs.push(on("hydra:drop", () => renderer?.drop(1)));
        if (shockOnTap) {
          const host = canvas.closest("section") ?? canvas;
          const onTap = (e: Event) => {
            if ((e.target as HTMLElement).closest("a,button")) return;
            renderer?.drop(0.6);
          };
          host.addEventListener("click", onTap);
          offs.push(() => host.removeEventListener("click", onTap));
        }
      });

    // After first paint; interactive canvases additionally wait until they are near the viewport.
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 1500 });
      else setTimeout(cb, 300); // Safari has no requestIdleCallback
    };
    let io: IntersectionObserver | null = null;
    if (interactive) {
      io = new IntersectionObserver(
        ([e]) => {
          if (e?.isIntersecting) {
            io?.disconnect();
            void load();
          }
        },
        { rootMargin: "400px 0px" },
      );
      io.observe(canvas);
    } else {
      idle(() => void load());
    }

    return () => {
      cancelled = true;
      io?.disconnect();
      offs.forEach((f) => f());
      renderer?.destroy();
    };
  }, [interactive, shockOnTap]);

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} data-gl={gl} aria-hidden="true">
      <div className="hydra-beams" />
      <canvas id={id} ref={canvasRef} className="absolute inset-0 size-full touch-pan-y" />
    </div>
  );
}
