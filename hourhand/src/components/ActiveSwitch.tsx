"use client";

import { useOptimistic, useTransition } from "react";
import { setEventTypeActive } from "@/app/dashboard/event-types/actions";
import { focusRing } from "./ui/focus";

/** On/off switch for one event type. Off means its booking link stops taking bookings. */
export function ActiveSwitch({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [on, setOn] = useOptimistic(active);
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      setOn(!on);
      await setEventTypeActive(id, !on);
    });
  }

  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={`Take bookings for ${name}`} aria-busy={pending || undefined} onClick={toggle}
      className={`inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-text ${focusRing}`}
    >
      <span aria-hidden className={`relative h-6 w-11 rounded-pill transition-colors ${on ? "bg-accent" : "bg-border-input"}`}>
        <span className={`absolute top-0.5 size-5 rounded-pill bg-card shadow-card transition-all ${on ? "left-5.5" : "left-0.5"}`} />
      </span>
      <span>{on ? "On" : "Off"}</span>
    </button>
  );
}
