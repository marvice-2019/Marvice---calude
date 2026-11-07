import { describe, expect, it } from "vitest";
import { createQualityController, QUALITY } from "../src/lib/light/quality";

describe("low-end bail-out", () => {
  it("gives up after 8 frames over 120 ms in a row, so the CSS beams take over", () => {
    const q = createQualityController(0.5);
    for (let i = 0; i < QUALITY.severeFrames - 1; i++) q.frame(200);
    expect(q.giveUp).toBe(false);
    q.frame(200);
    expect(q.giveUp).toBe(true);
  });

  it("a fast frame resets the count; the brief's 40 ms / 45-frame rule is unchanged", () => {
    const q = createQualityController(0.7);
    for (let i = 0; i < 7; i++) q.frame(200);
    q.frame(16);
    for (let i = 0; i < 7; i++) q.frame(200);
    expect(q.giveUp).toBe(false);
    const steady = createQualityController(0.7);
    let dropped = 0;
    for (let i = 0; i < 45; i++) if (steady.frame(50)) dropped++;
    expect(dropped).toBe(1);
    expect(steady.scale).toBeCloseTo(0.56, 5);
    expect(steady.giveUp).toBe(false);
  });
});
