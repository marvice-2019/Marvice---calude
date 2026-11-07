/**
 * Score for the header's house track (brief §4). Pure: no WebAudio here, so the
 * pattern is testable. 124 BPM, 16th-note steps, a 16-bar loop (256 steps).
 * Bars are 0-based in code; the brief's "bar 2" is index 1.
 */
export const BPM = 124;
export const STEPS_PER_BAR = 16;
export const LOOP_BARS = 16;
export const LOOP_STEPS = STEPS_PER_BAR * LOOP_BARS;
export const STEP_SECONDS = 60 / BPM / 4;

/** One chord per two bars (A minor: Am, F, C, G), as MIDI note numbers. */
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
] as const;

export type HouseStep = {
  kick: boolean;
  clap: boolean;
  openHat: boolean;
  closedHat: boolean;
  /** MIDI note for the saw bass, or null. */
  bass: number | null;
  /** Lowpass cutoff (Hz) for the bass on this step: sweeps up over each 4-bar phrase. */
  bassCutoff: number;
  /** MIDI note for the triangle pluck arpeggio, or null. */
  pluck: number | null;
  /** MIDI notes of the detuned saw pad chord (starts every 2 bars), or null. */
  pad: readonly number[] | null;
};

export function houseStep(step: number): HouseStep {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const pos = s % STEPS_PER_BAR;
  const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length] ?? CHORDS[0];
  const onBeat = pos % 4 === 0;
  const offBeat = pos % 4 === 2;
  const phrase = ((bar % 4) * STEPS_PER_BAR + pos) / (4 * STEPS_PER_BAR);
  const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
  return {
    kick: onBeat,
    clap: bar >= 1 && (pos === 4 || pos === 12),
    openHat: offBeat,
    closedHat: bar >= 1 && !offBeat,
    bass: bar >= 2 && offBeat ? chord[0] - 24 : null,
    bassCutoff: Math.round(220 * 2 ** (phrase * 3.5)),
    pluck: bar >= 4 && pos % 2 === 0 ? (arp[(pos / 2) % arp.length] ?? null) : null,
    pad: pos === 0 && bar % 2 === 0 ? chord : null,
  };
}

export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}
