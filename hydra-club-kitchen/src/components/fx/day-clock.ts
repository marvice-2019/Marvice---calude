/**
 * Day-to-night clock mapping (brief §3.6). Pure. Scroll progress 0..1 maps to
 * 12:00 PM .. 1:00 AM; panels cross-fade at their `from` times.
 */
export const CLOCK_START_MIN = 12 * 60;
export const CLOCK_SPAN_MIN = 13 * 60;

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/** Minutes after noon for progress p, floored to `step` minutes. */
export function minutesAfterNoon(p: number, step = 1): number {
  return Math.floor((clamp01(p) * CLOCK_SPAN_MIN) / step) * step;
}

/** "12:00 PM" style label for minutes after noon. */
export function formatClock(afterNoon: number): string {
  const total = CLOCK_START_MIN + afterNoon;
  const h24 = Math.floor(total / 60) % 24;
  const m = Math.floor(total % 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

export function clockLabel(p: number, step = 5): string {
  return formatClock(minutesAfterNoon(p, step));
}

/** "20:00" → minutes after noon (times before noon belong to the night: "00:00" → 720). */
export function fromToAfterNoon(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= CLOCK_START_MIN ? mins - CLOCK_START_MIN : mins + 24 * 60 - CLOCK_START_MIN;
}

/** Opacity of each panel at progress p; neighbours cross-fade over `fade` minutes around each boundary. */
export function panelOpacities(p: number, froms: readonly string[], fade = 40): number[] {
  const m = clamp01(p) * CLOCK_SPAN_MIN;
  const starts = froms.map(fromToAfterNoon);
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? Infinity;
    const fadeIn = i === 0 ? 1 : (m - start) / fade + 0.5;
    const fadeOut = end === Infinity ? 1 : (end - m) / fade + 0.5;
    return clamp01(Math.min(fadeIn, fadeOut));
  });
}
