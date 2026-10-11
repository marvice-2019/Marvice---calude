import "server-only";
import { api } from "./api";
import type { SearchRow } from "./contract";
import { defaultWindow, KIND_LABEL } from "./format";
import { SITE_URL } from "./site";

/** Lots near a point for public pages. Cached 5 minutes; an API outage renders an empty list, never a 500. */
export async function lotsNear(lat: number, lng: number): Promise<SearchRow[] | null> {
  const w = defaultWindow();
  // Round the window to the hour so the 5-minute cache is shared across visitors.
  try { return await api.search({ lat, lng, from: w.from.toISOString(), to: w.to.toISOString(), vehicle: "car" }); }
  catch { return null; }
}

/** schema.org ParkingFacility with an hourly Offer (SPEC S12). */
export function parkingJsonLd(r: { name: string; code: string; address: string; lat?: number; lng?: number; kind: string;
  open_24h: boolean; opens_at?: string | null; closes_at?: string | null; ratePaise: number; city?: string }) {
  const hours = r.open_24h ? "Mo-Su 00:00-23:59" : r.opens_at && r.closes_at ? `Mo-Su ${r.opens_at.slice(0, 5)}-${r.closes_at.slice(0, 5)}` : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "ParkingFacility",
    name: r.name,
    identifier: r.code,
    url: `${SITE_URL}/parking/bengaluru/lot/${r.code}`,
    description: `${KIND_LABEL[r.kind] ?? r.kind} parking, lot code ${r.code}. Pre-book and pay by UPI.`,
    address: { "@type": "PostalAddress", streetAddress: r.address, addressLocality: r.city ?? "Bengaluru", addressRegion: "Karnataka", addressCountry: "IN" },
    ...(r.lat !== undefined && r.lng !== undefined ? { geo: { "@type": "GeoCoordinates", latitude: r.lat, longitude: r.lng } } : {}),
    ...(hours ? { openingHours: hours } : {}),
    makesOffer: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (r.ratePaise / 100).toFixed(2),
      priceSpecification: { "@type": "UnitPriceSpecification", price: (r.ratePaise / 100).toFixed(2), priceCurrency: "INR", unitCode: "HUR", valueAddedTaxIncluded: false },
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/parking/bengaluru/lot/${r.code}`
    }
  };
}

/** Escapes a JSON-LD payload for safe inlining in a <script> tag. */
export const ld = (o: unknown) => ({ __html: JSON.stringify(o).replace(/</g, "\\u003c") });
