import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LotList } from "@/components/LotList";
import { AREAS, CITY } from "@/lib/places";
import { lotsNear } from "@/lib/seo";

export const revalidate = 300;
export const generateStaticParams = () => AREAS.map(a => ({ city: CITY.slug, area: a.slug }));
export const dynamicParams = false;

type P = { params: Promise<{ city: string; area: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const slug = (await params).area;
  const a = AREAS.find(x => x.slug === slug);
  if (!a) return {};
  return { title: `Parking in ${a.name}, Bengaluru`, description: `Book parking in ${a.name}. ${a.blurb} Prices with GST, pay by UPI.`,
    alternates: { canonical: `/parking/bengaluru/${a.slug}` } };
}

export default async function AreaPage({ params }: P) {
  const { city, area } = await params;
  const a = AREAS.find(x => x.slug === area);
  if (city !== CITY.slug || !a) notFound();
  const rows = await lotsNear(a.lat, a.lng);
  return (
    <section>
      <div className="crumbs"><Link href="/">Bayline</Link> › <Link href="/parking/bengaluru">Bengaluru</Link> › {a.name}</div>
      <div className="intro"><h1>Parking in {a.name}</h1><p>{a.blurb}</p></div>
      <p><Link className="btn" style={{ width: "auto", marginTop: 12 }} href={`/?area=${a.slug}`}>Check times and book</Link></p>
      <div style={{ marginTop: 16 }}><LotList rows={rows} emptyText={`No lots in ${a.name} yet. Lot owners: list your space.`} /></div>
    </section>
  );
}
