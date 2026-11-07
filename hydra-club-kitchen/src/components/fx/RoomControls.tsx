"use client";

import { useState } from "react";
import { LIGHT_MODES } from "@/content/site";
import { emit } from "@/lib/site-events";
import { track } from "@/lib/track";

type Mode = keyof typeof LIGHT_MODES;

/** Colour modes (also set --neon on the root) and the big Drop button. */
export function RoomControls({ dropLabel }: { dropLabel: string }) {
  const [mode, setMode] = useState<Mode>("hydra");

  function choose(m: Mode) {
    setMode(m);
    document.documentElement.dataset.lightMode = m;
    document.documentElement.style.setProperty("--neon", LIGHT_MODES[m].colours[0]);
    emit("hydra:mode", { mode: m });
  }

  function drop() {
    emit("hydra:drop", {});
    navigator.vibrate?.([22, 40, 22, 40, 60]);
    track("drop_click", { mode });
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Light colour">
        {(Object.keys(LIGHT_MODES) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => choose(m)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-bg/50 px-4 text-sm backdrop-blur aria-pressed:border-text"
          >
            <span className="size-3 rounded-full" style={{ background: LIGHT_MODES[m].colours[0], boxShadow: `0 0 10px ${LIGHT_MODES[m].colours[0]}` }} aria-hidden="true" />
            {LIGHT_MODES[m].label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={drop}
        className="hydra-drop size-36 rounded-full bg-aqua font-display text-3xl tracking-[-0.05em] text-on-aqua shadow-[0_0_60px_rgba(43,184,220,.55)] transition-transform active:scale-95 md:size-44 md:text-4xl"
      >
        {dropLabel}
      </button>
    </div>
  );
}
