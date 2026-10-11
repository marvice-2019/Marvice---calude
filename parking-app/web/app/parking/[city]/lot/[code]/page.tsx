import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Bill } from "@/components/Bill";
import { api, ApiFailure } from "@/lib/api";
import { defaultWindow, KIND_LABEL, inr, timings } from "@/lib/format";
import { CITY } from "@/lib/places";
import { ld, parkingJsonLd } from "@/lib/seo";

export const revalidate = 300;

type P = { params: Promise<{ city: string; code: string }> };

const load = cache(async (code: string) => {
  try {
    const { lot } = await api.lotByCode(code);
    const w = defaultWindow();
    return await api.lot(lot.id, { from: w.from.toISOString(), to: w.to.toISOString(), vehicle: "car" });
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const d = await load((await params).code).catch(() => null);
  if (!d) return { title: "Lot not found" };
  const l = d.lot;
  return {
    title: `${l.name} parking (${l.code}), Bengaluru`,
    description: `${KIND_LABEL[l.kind] ?? l.kind} parking at ${l.address}. ${inr(d.quote.ratePaise)}/hr + GST, ${timings(l)}. Pre-book and pay by UPI.`,
    alternates: { canonical: `/parking/bengaluru/lot/${l.code}` }
  };
}

/** S12 public lot page: crawlable, JSON-LD ParkingFacility + Offer, Book CTA into checkout (DRV-01, DRV-02). */
export default async function PublicLotPage({ params }: P) {
  const { city, code } = await params;
  if (city !== CITY.slug) notFound();
  const d = await load(code);
  if (!d) notFound();
  const l = d.lot, q = d.quote, w = defaultWindow();
  const bookHref = `/lot/${l.id}?` + new URLSearchParams({ from: w.from.toISOString(), to: w.to.toISOString(), vehicle: "car" });
  return (
    <article className="panelpage" style={{ maxWidth: 640 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(parkingJsonLd({ ...l, ratePaise: q.ratePaise }))} />
      <div className="crumbs"><Link href="/">Bayline</Link> › <Link href="/parking/bengaluru">Bengaluru</Link> › {l.name}</div>
      <span className="tag" style={{ color: "var(--sign)", display: "inline-block" }}>{KIND_LABEL[l.kind] ?? l.kind}</span>
      <h1>{l.name}</h1>
      <p style={{ color: "var(--muted)", margin: 0 }}><span className="lotcode">{l.code}</span> {l.address}</p>
      <dl className="kv">
        <dt>Price</dt><dd className="num">{inr(q.ratePaise)}/hr + GST, capped per day</dd>
        <dt>Timings</dt><dd>{timings(l)}</dd>
        <dt>Facilities</dt><dd>{[l.covered && "Covered", l.ev_chargers > 0 && `${l.ev_chargers} EV chargers`, "CCTV", "Attendant"].filter(Boolean).join(", ")}</dd>
        <dt>Entry</dt><dd>Show your pass QR, or give your plate to the attendant</dd>
      </dl>
      <div className="sec-h">Example: 3 hours from the next hour</div>
      <Bill q={q} />
      <div className="stack">
        <Link className="btn" href={bookHref}>Book this lot</Link>
        <Link className="btn ghost" href={`/park-now`}>Already here? Park now with code {l.code}</Link>
      </div>
    </article>
  );
}
