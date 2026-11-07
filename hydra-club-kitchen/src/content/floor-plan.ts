/**
 * Floor-plan geometry, in the prototype's coordinate space (viewBox 0 0 1290 1070).
 *
 * SCHEMATIC: neither the prototype SVG nor the client's floor-plan image is in the
 * repo yet, so this is a clean schematic. When floor-plan.jpeg arrives, set
 * `background` and re-trace the positions below; components only read this file.
 */
export type ZoneKey = "standard" | "vip" | "vvip" | "mezz";
export type FloorTable = { code: string; zone: ZoneKey; x: number; y: number; w: number; h: number; round?: boolean };
export type FloorFeature = { label: string; x: number; y: number; w: number; h: number; kind: "bar" | "stage" | "dance" | "mezz" | "entrance" };
/** Yellow markers 1–6 on the client's plan. Not bookable; meaning unknown, so `label` stays null until Hydra says. */
export type FloorMarker = { n: number; x: number; y: number; label: string | null };

export const VIEWBOX = { w: 1290, h: 1070 } as const;

/** Every table's tap area is at least this many viewBox units square (44 px at the 780 px mobile render). */
export const MIN_HIT = 76;
/** Width the plan renders at on phones (pannable inside its frame); keeps tap targets ≥ 44 px. */
export const MOBILE_RENDER_WIDTH = 780;

export const FLOOR = {
  background: null as string | null,
  room: { x: 40, y: 40, w: 1210, h: 990 },
  features: [
    { label: "DJ / Stage", x: 520, y: 70, w: 250, h: 100, kind: "stage" },
    { label: "Dance floor", x: 430, y: 230, w: 430, h: 330, kind: "dance" },
    { label: "Bar", x: 70, y: 200, w: 100, h: 560, kind: "bar" },
    { label: "Mezzanine · upstairs", x: 1080, y: 110, w: 150, h: 800, kind: "mezz" },
    { label: "Entrance", x: 580, y: 990, w: 130, h: 40, kind: "entrance" },
  ] satisfies FloorFeature[],
  tables: [
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ code: `T${i + 1}`, zone: "standard" as const, x: 230 + i * 130, y: 640, w: 90, h: 70 })),
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ code: `T${i + 7}`, zone: "standard" as const, x: 230 + i * 130, y: 800, w: 90, h: 70 })),
    { code: "VIP-1", zone: "vip", x: 270, y: 250, w: 120, h: 90, round: true },
    { code: "VIP-2", zone: "vip", x: 270, y: 430, w: 120, h: 90, round: true },
    { code: "VVIP-1", zone: "vvip", x: 900, y: 240, w: 140, h: 100, round: true },
    { code: "VVIP-2", zone: "vvip", x: 900, y: 420, w: 140, h: 100, round: true },
    ...[0, 1, 2, 3].map((i) => ({ code: `M${i + 1}`, zone: "mezz" as const, x: 1105, y: 180 + i * 180, w: 100, h: 110 })),
  ] satisfies FloorTable[] as FloorTable[],
  markers: [
    { n: 1, x: 120, y: 140, label: null },
    { n: 2, x: 120, y: 820, label: null },
    { n: 3, x: 470, y: 960, label: null },
    { n: 4, x: 820, y: 960, label: null },
    { n: 5, x: 1000, y: 620, label: null },
    { n: 6, x: 400, y: 150, label: null },
  ] satisfies FloorMarker[],
};

/** The tappable rectangle for a table: its own box, grown to MIN_HIT where smaller. */
export function hitBox(t: FloorTable) {
  const w = Math.max(t.w, MIN_HIT);
  const h = Math.max(t.h, MIN_HIT);
  return { x: t.x + t.w / 2 - w / 2, y: t.y + t.h / 2 - h / 2, w, h };
}
