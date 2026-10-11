import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { LotDetail } from "@/lib/contract";
import { defaultWindow } from "@/lib/format";
import { LotCheckout, type CheckoutParams } from "./LotCheckout";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Checkout is personal and time-bound: keep it out of search results. Public lot pages live under /parking.
export const metadata: Metadata = {
  title: "Book a lot",
  description: "Check the bill with GST, apply a promo code and pay by UPI, card or netbanking.",
  robots: { index: false, follow: true }
};

export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const vehicle = one(sp.vehicle) === "bike" ? "bike" : "car";
  let p: CheckoutParams;
  if (one(sp.now) === "1") {
    const h = Number(one(sp.hours));
    const hours = [1, 2, 3, 4, 8].includes(h) ? h : 2;
    // Park now starts this minute. Fixed here so server and browser render the same times.
    const from = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    p = { id, vehicle, mode: "now", hours, from: from.toISOString(), to: new Date(from.getTime() + hours * 3_600_000).toISOString() };
  } else {
    const w = defaultWindow();
    const from = one(sp.from), to = one(sp.to);
    p = { id, vehicle, mode: "prebook",
      from: from && !isNaN(Date.parse(from)) ? new Date(from).toISOString() : w.from.toISOString(),
      to: to && !isNaN(Date.parse(to)) ? new Date(to).toISOString() : w.to.toISOString() };
  }
  // Render the lot and bill on the server: no skeleton swap, so no layout shift. The browser
  // loads it again only if this fails (the client shows the API's message then).
  const initial: LotDetail | null = await api.lot(id, { from: p.from, to: p.to, vehicle }).catch(() => null);
  return <LotCheckout p={p} initial={initial} />;
}
