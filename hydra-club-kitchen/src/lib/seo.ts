import type { Settings } from "./settings";

export const SITE_NAME = "Hydra Club & Kitchen";
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const DAY_SCHEMA: Record<string, string> = {
  mon: "https://schema.org/Monday",
  tue: "https://schema.org/Tuesday",
  wed: "https://schema.org/Wednesday",
  thu: "https://schema.org/Thursday",
  fri: "https://schema.org/Friday",
  sat: "https://schema.org/Saturday",
  sun: "https://schema.org/Sunday",
};

/**
 * JSON-LD for the venue (brief §9): NightClub + Restaurant, verified facts only.
 * Phone appears only once set in admin; the street line only once the 5th vs
 * 6th Block question is confirmed; hours only when set.
 */
export function venueJsonLd(s: Settings) {
  const url = siteUrl();
  const address: Record<string, string> = {
    "@type": "PostalAddress",
    addressLocality: "Koramangala, Bengaluru",
    addressRegion: "Karnataka",
    postalCode: "560095",
    addressCountry: "IN",
  };
  if (s.address_block_confirmed && s.address) address.streetAddress = s.address.split(", Bengaluru")[0]!;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": ["NightClub", "Restaurant"],
    "@id": `${url}/#venue`,
    name: SITE_NAME,
    url,
    image: `${url}/opengraph-image`,
    address,
    servesCuisine: s.cuisines,
    acceptsReservations: true,
    sameAs: [s.instagram].filter(Boolean),
  };
  if (s.cost_for_two_inr) ld.priceRange = `About ₹${s.cost_for_two_inr.toLocaleString("en-IN")} for two`;
  if (s.phone) ld.telephone = s.phone;
  if (s.hours) {
    ld.openingHoursSpecification = Object.entries(s.hours)
      .filter(([, h]) => h)
      .map(([d, h]) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DAY_SCHEMA[d], opens: h!.open, closes: h!.close }));
  }
  if (s.maps_url) ld.hasMap = s.maps_url;
  return ld;
}

/** Safe to drop into <script type="application/ld+json">: no "</script>" breakout. */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
