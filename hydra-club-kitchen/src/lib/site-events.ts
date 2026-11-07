/**
 * Cross-section signals on the home page. Sections are owned by different
 * components, so they talk through window events rather than shared state.
 */
export const SECTION_IDS = {
  hero: "top",
  place: "place", // story
  room: "run-the-room",
  clock: "day-to-night",
  numbers: "numbers",
  vip: "vip",
  gallery: "gallery",
  menu: "menu",
  nights: "nights",
  floor: "floor",
  booking: "book",
  visit: "visit",
} as const;

export type SiteEvents = {
  /** Nights card "Pick a table for this night": booking pre-fills this service date. */
  "hydra:pick-date": { date: string };
  /** VIP cards: floor plan filters to and highlights this zone. */
  "hydra:pick-zone": { zone: "standard" | "vip" | "vvip" | "mezz" };
  /** Drop button: both light shows fire a shockwave; audio fires the impact if sound is on. */
  "hydra:drop": Record<string, never>;
  /** Sound toggled in the header. */
  "hydra:sound": { on: boolean };
  /** Light-show colour mode changed (also sets --neon on :root). */
  "hydra:mode": { mode: "hydra" | "violet" | "gold" | "ice" };
};

export function emit<K extends keyof SiteEvents>(name: K, detail: SiteEvents[K]) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on<K extends keyof SiteEvents>(name: K, fn: (detail: SiteEvents[K]) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<SiteEvents[K]>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
