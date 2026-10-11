import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LotCard } from "@/components/LotCard";
import { serverGet } from "@/lib/api";
import { rupees } from "@/lib/format";
import { allPlaces } from "@/lib/places";
import { nextQuarter, rangeQuery } from "@/lib/time";
import type { SearchRow } from "@/lib/types";

// Server-rendered landing pages ("parking near X"): the free acquisition channel (SPEC §4, SEO).
export const revalidate = 300;
type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const place = (await allPlaces()).find(p => p.slug === slug);
  if (!place) notFound();
  const query = rangeQuery(nextQuarter(), 2, "car");
  const rows = await serverGet<SearchRow[]>(`/v1/lots/search?${query}&lat=${place.lat}&lng=${place.lng}`, 300).catch(() => [] as SearchRow[]);
  return { place, rows, query };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { place, rows } = await load((await params).slug);
  const cheapest = rows.length ? Math.min(...rows.map(r => r.quote.ratePaise)) : null;
  return {
    title: `Parking near ${place.name}, Bengaluru`,
    description: `${rows.length} parking lots near ${place.name}${cheapest ? ` from ${rupees(cheapest)}/h` : ""}. See live bays, book ahead, pay by UPI, GST invoice included.`,
    alternates: { canonical: `/parking/${place.slug}` }
  };
}

export default async function PlacePage({ params }: Props) {
  const { place, rows, query } = await load((await params).slug);
  const jsonLd = {
    "@context": "https://schema.org", "@type": "ItemList", name: `Parking near ${place.name}`,
    itemListElement: rows.map((r, i) => ({
      "@type": "ListItem", position: i + 1,
      item: { "@type": "ParkingFacility", name: r.lot.name, url: `/lots/${r.lot.id}`,
        address: { "@type": "PostalAddress", streetAddress: r.lot.address, addressLocality: "Bengaluru", addressCountry: "IN" },
        makesOffer: { "@type": "Offer", priceCurrency: "INR", price: (r.quote.ratePaise / 100).toFixed(2), description: "Hourly rate before platform fee and GST" } }
    }))
  };
  return (
    <div className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header className="page-head">
        <span className="label">{place.kind} · Bengaluru</span>
        <h1>Parking near {place.name}</h1>
        <p>{rows.length ? `${rows.length} lots within 3 km. Prices below are for 2 hours from now, with fee and GST included.` : "No partner lots here yet."}</p>
      </header>
      <div className="grid2" style={{ marginTop: 18 }}>
        <ul className="lots">{rows.map((r, i) => <LotCard key={r.lot.id} row={r} query={query} i={i} />)}</ul>
        <aside className="stick card panel">
          <strong>Other places</strong>
          <div className="areas">{(await allPlaces()).filter(p => p.slug !== place.slug).slice(0, 14).map(p => <Link key={p.slug} className="chip" href={`/parking/${p.slug}`}>{p.name}</Link>)}</div>
        </aside>
      </div>
    </div>
  );
}
