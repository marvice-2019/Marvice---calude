import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LotList } from "@/components/LotList";
import { CITY, VENUES } from "@/lib/places";
import { lotsNear } from "@/lib/seo";

export const revalidate = 300;
export const generateStaticParams = () => VENUES.map(v => ({ city: CITY.slug, venue: v.slug }));
export const dynamicParams = false;

type P = { params: Promise<{ city: string; venue: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const slug = (await params).venue;
  const v = VENUES.find(x => x.slug === slug);
  if (!v) return {};
  return { title: `Parking near ${v.name}`, description: `Pre-book parking near ${v.name}, Bengaluru. ${v.blurb}`,
    alternates: { canonical: `/parking/bengaluru/venue/${v.slug}` } };
}

export default async function VenuePage({ params }: P) {
  const { city, venue } = await params;
  const v = VENUES.find(x => x.slug === venue);
  if (city !== CITY.slug || !v) notFound();
  const rows = await lotsNear(v.lat, v.lng);
  return (
    <section>
      <div className="crumbs"><Link href="/">Bayline</Link> › <Link href="/parking/bengaluru">Bengaluru</Link> › {v.name}</div>
      <div className="intro"><h1>Parking near {v.name}</h1><p>{v.blurb}</p></div>
      <div style={{ marginTop: 16 }}><LotList rows={rows} emptyText={`No lots within 3 km of ${v.name} yet.`} /></div>
    </section>
  );
}
