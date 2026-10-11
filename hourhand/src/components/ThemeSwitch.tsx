"use client";

import { useSyncExternalStore } from "react";
import { focusRing } from "@/components/ui/focus";
import { THEME_KEY, parseTheme, type ThemeChoice } from "@/lib/theme";

const listeners = new Set<() => void>();
let override: ThemeChoice | null = null; // keeps the choice for this visit when storage is unavailable

function read(): ThemeChoice {
  if (override) return override;
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

function choose(choice: ThemeChoice) {
  override = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked: the choice still holds for this visit.
  }
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Light, dark, or match the device. The server render shows "Device" so hydration matches; the head script has already applied the saved theme. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const current = useSyncExternalStore(subscribe, read, () => "system" as const);
  return (
    <fieldset className={`inline-flex items-center gap-1 rounded-md border border-border p-1 ${className}`}>
      <legend className="sr-only">Appearance</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className={`inline-flex min-h-9 cursor-pointer items-center rounded px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${current === o.value ? "bg-surface font-semibold text-text" : "text-text-muted hover:text-text"}`}>
          <input type="radio" name="hh-theme" value={o.value} checked={current === o.value} onChange={() => choose(o.value)} className={`sr-only ${focusRing}`} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
