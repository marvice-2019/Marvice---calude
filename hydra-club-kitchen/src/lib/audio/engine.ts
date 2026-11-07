/**
 * House track synthesised with WebAudio (brief §4). No audio files. Loaded with
 * import() only after the visitor taps Sound. Names are namespaced (house*) on
 * purpose: the prototype once had an audio helper `pad` overwrite a date helper.
 */
import { reportKick } from "@/lib/beat";
import { houseStep, LOOP_STEPS, midiToHz, STEP_SECONDS, STEPS_PER_BAR } from "./pattern";

export type HouseEngine = {
  readonly analyser: AnalyserNode;
  start(): void;
  /** Ramps the master down, then suspends the context. */
  stop(): Promise<void>;
  /** Sub impact (sine 90→28 Hz) plus a rising noise sweep. */
  dropImpact(): void;
};

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const MASTER_LEVEL = 0.55;

export function createHouseEngine(ctx: AudioContext): HouseEngine {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  master.connect(compressor).connect(analyser).connect(ctx.destination);

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  function houseNoise(t: number, dur: number, filter: BiquadFilterType, freq: number, level: number, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function houseKick(t: number) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.34);
    // Tell the visuals when this kick actually sounds.
    const delay = Math.max(0, (t - ctx.currentTime) * 1000);
    setTimeout(() => reportKick(performance.now()), delay);
  }

  function houseClap(t: number) {
    for (const d of [0, 0.012, 0.024]) houseNoise(t + d, 0.14, "bandpass", 1500, 0.55, 0.9);
  }

  function houseBass(t: number, note: number, cutoff: number) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = midiToHz(note);
    f.type = "lowpass";
    f.Q.value = 9;
    f.frequency.setValueAtTime(cutoff * 1.8, t);
    f.frequency.exponentialRampToValueAtTime(cutoff, t + STEP_SECONDS * 1.6);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP_SECONDS * 1.9);
    o.connect(f).connect(g).connect(master);
    o.start(t);
    o.stop(t + STEP_SECONDS * 2);
  }

  function housePluck(t: number, note: number) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = midiToHz(note);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.28);
  }

  function housePadChord(t: number, notes: readonly number[]) {
    const dur = STEP_SECONDS * STEPS_PER_BAR * 2;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.4);
    g.gain.setValueAtTime(0.07, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(master);
    for (const n of notes) {
      for (const detune of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiToHz(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  let step = 0;
  let nextTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function houseSchedule() {
    while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
      const s = houseStep(step);
      if (s.kick) houseKick(nextTime);
      if (s.clap) houseClap(nextTime);
      if (s.openHat) houseNoise(nextTime, 0.22, "highpass", 7000, 0.12);
      if (s.closedHat) houseNoise(nextTime, 0.04, "highpass", 9000, 0.08);
      if (s.bass !== null) houseBass(nextTime, s.bass, s.bassCutoff);
      if (s.pluck !== null) housePluck(nextTime, s.pluck);
      if (s.pad) housePadChord(nextTime, s.pad);
      nextTime += STEP_SECONDS;
      step = (step + 1) % LOOP_STEPS;
    }
  }

  return {
    analyser,
    start() {
      if (timer) return;
      void ctx.resume();
      step = 0;
      nextTime = ctx.currentTime + 0.06;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(MASTER_LEVEL, ctx.currentTime + 0.8);
      houseSchedule();
      timer = setInterval(houseSchedule, TICK_MS);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.35);
      await new Promise((r) => setTimeout(r, 400));
      await ctx.suspend();
    },
    dropImpact() {
      const t = ctx.currentTime + 0.01;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 1.15);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 3;
      f.frequency.setValueAtTime(300, t - 0.01);
      f.frequency.exponentialRampToValueAtTime(7000, t + 0.9);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.35, t + 0.8);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      src.connect(f).connect(ng).connect(master);
      src.start(t);
      src.stop(t + 1.05);
    },
  };
}
