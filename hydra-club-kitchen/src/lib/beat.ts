/**
 * Beat bus: the audio engine reports kicks; visuals read a 0..1 level that
 * jumps on each kick and decays. Times are performance.now() milliseconds.
 * Pure state + functions so it is testable and shared across islands.
 */
const DECAY_MS = 220;
let lastKick = -Infinity;
let soundOn = false;

export function reportKick(atMs: number) {
  lastKick = atMs;
}

export function setSoundOn(on: boolean) {
  soundOn = on;
  if (!on) lastKick = -Infinity;
}

export function isSoundOn() {
  return soundOn;
}

/** Current beat level: 1 right on a kick, easing to 0 over ~220 ms; 0 with the sound off. */
export function beatLevel(nowMs: number): number {
  if (!soundOn) return 0;
  const dt = nowMs - lastKick;
  if (dt < 0 || dt > DECAY_MS * 3) return 0;
  return Math.exp(-dt / DECAY_MS);
}
