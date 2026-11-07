/**
 * Venue seed data. Only facts verified from public listings live here; anything
 * unconfirmed ships empty so the UI that depends on it stays hidden and admin
 * shows a warning (brief §12).
 */

export const ZONES = [
  // Colours are placeholders from the brand palette until the prototype's CONFIG is ported.
  { key: "standard", name: "Standard", colour: "#2BB8DC", sort: 0 },
  { key: "vip", name: "VIP", colour: "#4A93E8", sort: 1 },
  { key: "vvip", name: "VVIP", colour: "#E3B26A", sort: 2 },
  { key: "mezz", name: "Mezzanine", colour: "#8B5CF6", sort: 3 },
] as const;

type ZoneKey = (typeof ZONES)[number]["key"];

const range = (prefix: string, n: number, sep = "") =>
  Array.from({ length: n }, (_, i) => `${prefix}${sep}${i + 1}`);

/** The 20 bookable tables on the floor plan. Seat counts are unconfirmed, so they stay null. */
export const TABLES: { code: string; zone: ZoneKey }[] = [
  ...range("T", 12).map((code) => ({ code, zone: "standard" as const })),
  ...range("VIP", 2, "-").map((code) => ({ code, zone: "vip" as const })),
  ...range("VVIP", 2, "-").map((code) => ({ code, zone: "vvip" as const })),
  ...range("M", 4).map((code) => ({ code, zone: "mezz" as const })),
];

export type WeekdayHours = { open: string; close: string } | null;

/** Settings keys and their seed values. `null` / "" = unconfirmed, hidden on the site. */
export const SETTINGS: Record<string, unknown> = {
  // Unconfirmed (§12): three numbers are in circulation, listings disagree on hours.
  whatsapp: "",
  phone: "",
  hours: null as Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", WeekdayHours> | null,
  // Verified, except 5th vs 6th Block (flagged until the client confirms).
  address:
    "106/A, 4th C Cross, 1st Main Road, KHB Colony, Industrial Area, Koramangala 5th Block, Bengaluru 560095",
  address_block_confirmed: false,
  maps_url: "https://www.google.com/maps/search/?api=1&query=Hydra+Club+%26+Kitchen+Koramangala+Bengaluru",
  instagram: "https://www.instagram.com/hydraclubkitchen/",
  good_to_know: ["Valet parking", "AC", "Dance floor", "Live sports", "Smoking area", "Veg and non-veg"],
  cost_for_two_inr: 2000,
  cuisines: ["Japanese", "North Indian", "South Indian", "Continental", "Biryani", "Chinese"],
  // Booking defaults (our call, editable in admin).
  slot_length_minutes: 120,
  booking_window_days: 14,
  max_guests_per_table: 12,
  booking_enabled: true,
};

/**
 * Nights come from the prototype's CONFIG (/reference/hydra-club-kitchen.html),
 * which is not in the repo yet. Empty until it is ported; never invent events.
 */
export const NIGHTS: {
  title: string;
  days: string;
  blurb: string;
  accent: "rose" | "amber" | "aqua";
  ctaDateRule: string | null;
}[] = [];
