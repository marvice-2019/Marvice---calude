/**
 * Copy and config that the approved prototype (/reference/hydra-club-kitchen.html)
 * is the source of truth for. The prototype is not in the repo yet, so these are
 * written from the brief. When it arrives, replace values HERE; components only
 * read from this file. Anything marked PROTOTYPE must be checked against it.
 */
export const TAGLINE = "Eat first. Stay late.";

export const NAV = [
  { id: "place", label: "The place" },
  { id: "gallery", label: "Gallery" },
  { id: "menu", label: "Menu" },
  { id: "nights", label: "Nights" },
  { id: "vip", label: "VIP" },
  { id: "floor", label: "Floor plan" },
  { id: "visit", label: "Visit" },
] as const;

/** Hero scenes, auto-advancing every 5.6 s. `tag` matches photos.hero_scene. */
export const HERO_SCENES = [
  { tag: "club", label: "Club" },
  { tag: "kitchen", label: "Kitchen" },
  { tag: "bar", label: "Bar" },
  { tag: "floor", label: "Floor" },
] as const;
export const HERO_SCENE_MS = 5600;

export const MARQUEE = ["Dance floor", "VVIP", "Live sports", "Bar", "VIP", "Valet", "Stage", "Mezzanine"] as const;

/** PROTOTYPE: story paragraph, revealed word by word. */
export const STORY =
  "Hydra is a kitchen until the lights drop, then it's a club. Japanese, North and South Indian, Continental, biryani and Chinese on the plates; a dance floor, a mezzanine and VIP tables when the music comes up. Come for dinner. Nobody leaves after dinner.";

/** Light-show colour modes (brief §4). Changing mode sets --neon to the first colour. */
export const LIGHT_MODES = {
  hydra: { label: "Hydra", colours: ["#2BB8DC", "#4A93E8", "#E3B26A"] },
  violet: { label: "Violet", colours: ["#8B5CF6", "#E040FB", "#4A93E8"] },
  gold: { label: "Gold", colours: ["#E3B26A", "#FF7A3D", "#FFE3A8"] },
  ice: { label: "Ice", colours: ["#BFF3FF", "#2BB8DC", "#FFFFFF"] },
} as const;

/** PROTOTYPE: Run-the-room copy. */
export const RUN_THE_ROOM = {
  heading: "Run the room",
  body: "Move your finger or mouse to aim the lasers. Pick a colour. Then hit the drop.",
  dropLabel: "Drop",
};

/** PROTOTYPE: day-to-night clock panels (12:00 PM → 1:00 AM). */
export const DAY_TO_NIGHT = [
  { from: "12:00", title: "Kitchen", body: "Long lunches, slow plates, live sports on the screens." },
  { from: "20:00", title: "Club", body: "Lights drop, the DJ takes over, the floor fills up." },
  { from: "00:00", title: "Last call", body: "One more round before the 1 AM close." },
] as const;

/** PROTOTYPE: VIP section card copy, used when the zone's admin note is empty. */
export const VIP_CARDS = {
  vip: { title: "VIP", body: "Raised tables beside the floor, bottle service and a host who knows your name." },
  vvip: { title: "VVIP", body: "The best seats in the house. Private, close to the decks, your own service." },
  mezz: { title: "Mezzanine", body: "Above the crowd with the whole room below you." },
} as const;

/** Footer credit (brief §3.15). Add an href once Marvice confirms which site to link. */
export const BUILT_BY = { label: "Website by Marvice Media" };
