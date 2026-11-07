"use client";

import { useEffect, useRef, useState } from "react";
import type { HouseEngine } from "@/lib/audio/engine";
import { setSoundOn } from "@/lib/beat";
import { emit, on } from "@/lib/site-events";
import { track } from "@/lib/track";

/**
 * Header Sound toggle. Never autoplays. The AudioContext is created inside the
 * click (iOS needs that), then the synth engine is imported. Stops when the tab
 * is hidden. The four bars follow an AnalyserNode.
 */
export function SoundButton({ className = "" }: { className?: string }) {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<HouseEngine | null>(null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  async function start() {
    ctxRef.current ??= new AudioContext();
    if (!engineRef.current) {
      const { createHouseEngine } = await import("@/lib/audio/engine");
      engineRef.current = createHouseEngine(ctxRef.current);
    }
    engineRef.current.start();
    setSoundOn(true);
    setPlaying(true);
    emit("hydra:sound", { on: true });
    track("sound_on");
  }

  async function stop() {
    setPlaying(false);
    setSoundOn(false);
    emit("hydra:sound", { on: false });
    await engineRef.current?.stop();
  }

  useEffect(() => {
    const onHide = () => document.hidden && playing && void stop();
    document.addEventListener("visibilitychange", onHide);
    const offDrop = on("hydra:drop", () => playing && engineRef.current?.dropImpact());
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      offDrop();
    };
  }, [playing]);

  // Bars follow the analyser while playing.
  useEffect(() => {
    if (!playing || !engineRef.current) return;
    const analyser = engineRef.current.analyser;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const bars = barsRef.current;
    let raf = 0;
    const loop = () => {
      analyser.getByteFrequencyData(bins);
      bars.forEach((bar, i) => {
        const v = (bins[1 + i * 4] ?? 0) / 255;
        if (bar) bar.style.transform = `scaleY(${(0.2 + v * 0.8).toFixed(3)})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      bars.forEach((bar) => bar && (bar.style.transform = ""));
    };
  }, [playing]);

  return (
    <button
      type="button"
      aria-pressed={playing}
      aria-label={playing ? "Sound on. Turn sound off" : "Turn sound on"}
      onClick={() => void (playing ? stop() : start())}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line px-3 text-sm aria-pressed:border-aqua sm:px-4 ${className}`}
    >
      <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            ref={(el) => {
              barsRef.current[i] = el;
            }}
            className="block h-4 w-[3px] origin-bottom scale-y-[.3] rounded-full bg-aqua"
          />
        ))}
      </span>
      <span className="hidden sm:inline">Sound</span>
    </button>
  );
}
