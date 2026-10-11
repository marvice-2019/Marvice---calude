import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AREAS, CITY, VENUES } from "@/lib/places";

export const revalidate = 3600;
export const generateStaticParams = () => [{ city: CITY.slug }];
export const dynamicParams = false;

export const metadata: Metadata = {
  title: "Parking in Bengaluru: book by the hour or month",
  description: "Pre-book parking across Bengaluru: MG Road, Indiranagar, Koramangala, Whitefield, Hebbal and the airport. Full price with GST before you pay.",
  alternates: { canonical: "/parking/bengaluru" }
};

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  if ((await params).city !== CITY.slug) notFound();
  return (
    <section className="prose">
      <div className="crumbs"><Link href="/">Bayline</Link> › Bengaluru</div>
      <div className="intro"><h1>Parking in Bengaluru</h1>
        <p>Book a bay before you leave, see the full price with GST up front, and pay by UPI. Your pass arrives on WhatsApp.</p></div>
      <h2>By area</h2>
      <ul>{AREAS.map(a => <li key={a.slug}><Link href={`/parking/bengaluru/${a.slug}`}>Parking in {a.name}</Link></li>)}</ul>
      <h2>Near venues</h2>
      <ul>{VENUES.map(v => <li key={v.slug}><Link href={`/parking/bengaluru/venue/${v.slug}`}>Parking near {v.name}</Link></li>)}</ul>
      <h2>Monthly parking</h2>
      <p>One fee for unlimited entries at one lot. <Link href="/monthly">See monthly lots</Link>.</p>
    </section>
  );
}
