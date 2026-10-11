import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Checkout } from "@/components/Checkout";
import { ApiFailure, serverGet } from "@/lib/api";
import { rupees } from "@/lib/format";
import { nextQuarter } from "@/lib/time";
import type { LotDetailResponse } from "@/lib/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

async function load(id: string, sp: Record<string, string | undefined>) {
  const from = sp.from && !isNaN(Date.parse(sp.from)) ? new Date(sp.from) : nextQuarter();
  const to = sp.to && !isNaN(Date.parse(sp.to)) && Date.parse(sp.to) > from.getTime() ? new Date(sp.to) : new Date(from.getTime() + 2 * 3_600_000);
  const vehicle = ["car", "bike", "ev_car", "suv"].includes(sp.vehicle ?? "") ? sp.vehicle! : "car";
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), vehicle });
  try { return { data: await serverGet<LotDetailResponse>(`/v1/lots/${id}?${q}`, 30), from, to, vehicle }; }
  catch (e) { if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound(); throw e; }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { data } = await load((await params).id, await searchParams);
  return {
    title: `${data.lot.name} parking`,
    description: `Book a bay at ${data.lot.name}, ${data.lot.address}. ${data.lot.covered ? "Covered. " : ""}${data.lot.ev_chargers ? "EV charging. " : ""}From ${rupees(data.quote.ratePaise)}/h plus GST.`,
    alternates: { canonical: `/lots/${data.lot.id}` }
  };
}

export default async function LotPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { data, from, to, vehicle } = await load(id, await searchParams);
  const { lot, quote, spots_left } = data;
  const hours = lot.open_24h ? "Open 24 hours" : lot.opens_at && lot.closes_at ? `${lot.opens_at.slice(0, 5)}–${lot.closes_at.slice(0, 5)}` : "Hours vary";
  const jsonLd = {
    "@context": "https://schema.org", "@type": "ParkingFacility", name: lot.name, identifier: lot.code,
    address: { "@type": "PostalAddress", streetAddress: lot.address, addressLocality: lot.city, addressCountry: "IN" },
    geo: { "@type": "GeoCoordinates", latitude: lot.lat, longitude: lot.lng },
    openingHours: lot.open_24h ? "Mo-Su 00:00-23:59" : undefined,
    makesOffer: { "@type": "Offer", priceCurrency: "INR", price: (quote.ratePaise / 100).toFixed(2), description: "Hourly rate before platform fee and GST",
      availability: spots_left > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut" }
  };

  return (
    <div className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" style={{ paddingTop: 18, fontSize: 14 }}><Link href="/" className="muted">← All lots</Link></nav>
      <div className="grid2">
        <div>
          <header className="lothero rise">
            <span className="code">{lot.code.replace(/^BLR/, "")}</span>
            <h1>{lot.name}</h1>
            <p className="muted" style={{ margin: 0 }}>{lot.address}, {lot.city}</p>
          </header>
          <div className="facts">
            <div className="fact rise" style={{ "--i": 1 } as React.CSSProperties}><b className="num">{rupees(quote.ratePaise)}</b><span className="muted">per hour</span></div>
            <div className="fact rise" style={{ "--i": 2 } as React.CSSProperties}><b className="num">{spots_left}</b><span className="muted">bays free then</span></div>
            <div className="fact rise" style={{ "--i": 3 } as React.CSSProperties}><b>{lot.covered ? "Covered" : "Open air"}</b><span className="muted">{lot.kind.replace("_", " ")}</span></div>
            <div className="fact rise" style={{ "--i": 4 } as React.CSSProperties}><b>{lot.ev_chargers || "—"}</b><span className="muted">EV chargers</span></div>
          </div>
          <div className="mapbox" role="img" aria-label={`Map pin for ${lot.name}`}>
            <span className="pulse" /><span className="pin">P {lot.code.replace(/^BLR/, "")}</span>
          </div>
          <p style={{ marginTop: 10 }}>
            <a className="link" href={`https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}`} target="_blank" rel="noopener noreferrer">Directions in Google Maps</a>
          </p>
          <div className="card panel" style={{ marginTop: 14 }}>
            <strong>Good to know</strong>
            <div className="list-row"><span className="muted">Hours</span><span>{hours}</span></div>
            <div className="list-row"><span className="muted">Entry</span><span>Show your pass QR at the gate</span></div>
            <div className="list-row"><span className="muted">Daily cap</span><span>Never more than 8 hours&apos; rate per 24 h</span></div>
            <div className="list-row"><span className="muted">Cancel</span><span>Free up to 1 hour before arrival</span></div>
          </div>
        </div>
        <div className="stick" style={{ paddingTop: 28 }}>
          <Checkout lotId={lot.id} lotName={lot.name} initialQuote={quote} from={from.toISOString()} to={to.toISOString()} vehicle={vehicle} full={spots_left === 0 || lot.status !== "open"} />
        </div>
      </div>
    </div>
  );
}
