import { describe, expect, it } from "vitest";
import { beatLevel, reportKick, setSoundOn } from "../src/lib/beat";
import { FRAGMENT_SHADER, hexToRgb } from "../src/lib/light/shader";

describe("beat bus", () => {
  it("is silent with the sound off, peaks on a kick and decays", () => {
    setSoundOn(false);
    reportKick(1000);
    expect(beatLevel(1000)).toBe(0);
    setSoundOn(true);
    reportKick(1000);
    expect(beatLevel(1000)).toBe(1);
    expect(beatLevel(1220)).toBeCloseTo(Math.exp(-1), 5);
    expect(beatLevel(1000 + 700)).toBe(0);
    setSoundOn(false);
    expect(beatLevel(1001)).toBe(0);
  });
});

describe("light show", () => {
  it("keeps the brief's shader with all ten uniforms", () => {
    for (const u of ["uRes", "uM", "uT", "uBeat", "uDrop", "uAim", "uN", "uA", "uB", "uC"]) expect(FRAGMENT_SHADER).toContain(`uniform ${u === "uRes" || u === "uM" ? "vec2" : ["uA", "uB", "uC"].includes(u) ? "vec3" : "float"} ${u};`);
    expect(FRAGMENT_SHADER).toContain("col=1.-exp(-col*1.25);");
  });

  it("converts palette hex to 0..1 RGB", () => {
    expect(hexToRgb("#2BB8DC")).toEqual([43 / 255, 184 / 255, 220 / 255]);
    expect(hexToRgb("#FFFFFF")).toEqual([1, 1, 1]);
  });
});
