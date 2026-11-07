/**
 * Light-show resolution and adaptive quality (brief §4). Pure, so it is testable
 * without WebGL. Resolution starts at 0.5x on touch devices and 0.7x on desktop
 * (DPR capped at 1.5). If the frame-time moving average stays above 40 ms for
 * 45 frames in a row, resolution is multiplied by 0.8, never below 0.36.
 */
export const QUALITY = {
  touchScale: 0.5,
  desktopScale: 0.7,
  dprCap: 1.5,
  slowMs: 40,
  slowFrames: 45,
  step: 0.8,
  floor: 0.36,
  /** Weight of the newest frame in the exponential moving average. */
  smoothing: 0.1,
} as const;

export function baseScale(touch: boolean): number {
  return touch ? QUALITY.touchScale : QUALITY.desktopScale;
}

/** Backing-store size for a canvas of the given CSS size. */
export function canvasSize(cssWidth: number, cssHeight: number, dpr: number, scale: number) {
  const k = Math.min(dpr || 1, QUALITY.dprCap) * scale;
  return { width: Math.max(1, Math.round(cssWidth * k)), height: Math.max(1, Math.round(cssHeight * k)) };
}

export type QualityController = {
  readonly scale: number;
  /** Feed one frame time in ms; returns true when the scale just dropped. */
  frame(ms: number): boolean;
};

export function createQualityController(start: number): QualityController {
  let scale = start;
  let average: number | null = null;
  let slow = 0;
  return {
    get scale() {
      return scale;
    },
    frame(ms) {
      average = average === null ? ms : average + (ms - average) * QUALITY.smoothing;
      slow = average > QUALITY.slowMs ? slow + 1 : 0;
      if (slow < QUALITY.slowFrames || scale <= QUALITY.floor) return false;
      scale = Math.max(QUALITY.floor, scale * QUALITY.step);
      // Measure the new resolution afresh.
      slow = 0;
      average = null;
      return true;
    },
  };
}
