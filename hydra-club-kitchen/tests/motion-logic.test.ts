import { describe, expect, it } from "vitest";
import { clockLabel, formatClock, fromToAfterNoon, panelOpacities } from "@/components/fx/day-clock";
import { DAY_TO_NIGHT } from "@/content/site";
import { houseStep, LOOP_STEPS } from "@/lib/audio/pattern";
import { baseScale, canvasSize, createQualityController, QUALITY } from "@/lib/light/quality";

const at = (bar1: number, pos: number) => houseStep((bar1 - 1) * 16 + pos);
const positions = (bar1: number, pick: (s: ReturnType<typeof houseStep>) => unknown) =>
  Array.from({ length: 16 }, (_, pos) => pos).filter((pos) => Boolean(pick(at(bar1, pos))));

describe("house pattern (16 steps x 16 bars)", () => {
  it("kicks on every beat of every bar", () => {
    for (let bar = 1; bar <= 16; bar++) expect(positions(bar, (s) => s.kick)).toEqual([0, 4, 8, 12]);
  });

  it("claps on beats 2 and 4 from bar 2", () => {
    expect(positions(1, (s) => s.clap)).toEqual([]);
    for (let bar = 2; bar <= 16; bar++) expect(positions(bar, (s) => s.clap)).toEqual([4, 12]);
  });

  it("open hat on every off-beat, closed hats from bar 2", () => {
    for (let bar = 1; bar <= 16; bar++) expect(positions(bar, (s) => s.openHat)).toEqual([2, 6, 10, 14]);
    expect(positions(1, (s) => s.closedHat)).toEqual([]);
    expect(positions(2, (s) => s.closedHat)).toEqual([0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]);
  });

  it("saw bass from bar 3 with a rising lowpass sweep", () => {
    expect(positions(1, (s) => s.bass)).toEqual([]);
    expect(positions(2, (s) => s.bass)).toEqual([]);
    expect(positions(3, (s) => s.bass)).toEqual([2, 6, 10, 14]);
    expect(at(3, 2).bass).toBe(29); // F1 under the F chord of bars 3-4
    expect(at(1, 0).bassCutoff).toBeLessThan(at(4, 15).bassCutoff);
  });

  it("triangle pluck arpeggio from bar 5", () => {
    for (let bar = 1; bar <= 4; bar++) expect(positions(bar, (s) => s.pluck)).toEqual([]);
    expect(positions(5, (s) => s.pluck)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("pad chord starts every 2 bars", () => {
    const padBars = Array.from({ length: 16 }, (_, i) => i + 1).filter((bar) => positions(bar, (s) => s.pad).length > 0);
    expect(padBars).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(positions(1, (s) => s.pad)).toEqual([0]);
    expect(at(1, 0).pad).toEqual([57, 60, 64]);
  });

  it("loops after 256 steps", () => {
    expect(LOOP_STEPS).toBe(256);
    expect(houseStep(256)).toEqual(houseStep(0));
    expect(houseStep(256 + 37)).toEqual(houseStep(37));
  });
});

describe("light-show adaptive quality", () => {
  it("starts at 0.5x on touch and 0.7x on desktop, DPR capped at 1.5", () => {
    expect(baseScale(true)).toBe(0.5);
    expect(baseScale(false)).toBe(0.7);
    expect(canvasSize(1000, 500, 3, 0.7)).toEqual({ width: 1050, height: 525 });
    expect(canvasSize(1000, 500, 1, 0.5)).toEqual({ width: 500, height: 250 });
  });

  it("drops resolution by 0.8 only after 45 slow frames in a row", () => {
    const q = createQualityController(0.7);
    for (let i = 0; i < 44; i++) expect(q.frame(50)).toBe(false);
    expect(q.scale).toBe(0.7);
    expect(q.frame(50)).toBe(true);
    expect(q.scale).toBeCloseTo(0.56);
  });

  it("a fast stretch resets the slow-frame count", () => {
    const q = createQualityController(0.7);
    for (let i = 0; i < 40; i++) q.frame(50);
    for (let i = 0; i < 60; i++) q.frame(5);
    for (let i = 0; i < 44; i++) q.frame(50);
    expect(q.scale).toBe(0.7);
  });

  it("never goes below the 0.36 floor", () => {
    const q = createQualityController(0.5);
    for (let i = 0; i < 1000; i++) q.frame(100);
    expect(q.scale).toBe(QUALITY.floor);
    expect(q.frame(100)).toBe(false);
  });
});

describe("day-to-night clock", () => {
  it("maps scroll progress 0..1 to 12:00 PM..1:00 AM", () => {
    expect(clockLabel(0)).toBe("12:00 PM");
    expect(clockLabel(0.5)).toBe("6:30 PM");
    expect(clockLabel(1)).toBe("1:00 AM");
    expect(clockLabel(-1)).toBe("12:00 PM");
    expect(clockLabel(2)).toBe("1:00 AM");
    expect(formatClock(720)).toBe("12:00 AM");
    expect(formatClock(480)).toBe("8:00 PM");
  });

  it("panels cross-fade at their start times", () => {
    const froms = DAY_TO_NIGHT.map((p) => p.from);
    expect(froms.map(fromToAfterNoon)).toEqual([0, 480, 720]);
    expect(panelOpacities(0, froms)).toEqual([1, 0, 0]);
    expect(panelOpacities(600 / 780, froms)).toEqual([0, 1, 0]);
    expect(panelOpacities(480 / 780, froms)).toEqual([0.5, 0.5, 0]);
    expect(panelOpacities(1, froms)).toEqual([0, 0, 1]);
  });
});
