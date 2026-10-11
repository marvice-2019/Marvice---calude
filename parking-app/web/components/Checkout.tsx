"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { cleanPlate, PLATE, rupees, when } from "@/lib/format";
import { pay } from "@/lib/pay";
import type { ApiError, CreateBookingResponse, Quote } from "@/lib/types";
import { SignIn } from "./SignIn";
import { useMe } from "./useMe";

const METHODS = [{ id: "upi", label: "UPI", sub: "GPay, PhonePe, Paytm, BHIM" }, { id: "card", label: "Card", sub: "Debit or credit" }, { id: "netbanking", label: "Netbanking", sub: "All major banks" }];

export function Bill({ q }: { q: Quote }) {
  return (
    <div className="bill" aria-label="Price breakdown">
      <div><span>Parking · {q.hours} h × {rupees(q.ratePaise)}</span><span>{rupees(q.basePaise)}</span></div>
      {q.discountPaise > 0 && <div className="disc"><span>Promo {q.promoCode}</span><span>−{rupees(q.discountPaise)}</span></div>}
      <div><span>Platform fee</span><span>{rupees(q.feePaise)}</span></div>
      <div><span>GST 18%</span><span>{rupees(q.gstPaise)}</span></div>
      <div className="tot"><span>Total</span><span>{rupees(q.totalPaise)}</span></div>
    </div>
  );
}

type Props = { lotId: string; lotName: string; initialQuote: Quote; from: string; to: string; vehicle: string; full: boolean };

export function Checkout({ lotId, lotName, initialQuote, from, to, vehicle, full }: Props) {
  const router = useRouter();
  const { me, reload } = useMe();
  const [quote, setQuote] = useState(initialQuote);
  const [promo, setPromo] = useState(""), [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [plate, setPlate] = useState(""), [method, setMethod] = useState("upi");
  const [err, setErr] = useState(""), [alts, setAlts] = useState<ApiError["alternatives"]>([]);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<CreateBookingResponse | null>(null);

  const savedPlate = me?.vehicles[0]?.plate ?? "";
  const plateValue = plate || savedPlate;

  async function applyPromo() {
    if (!promo.trim()) return;
    setPromoMsg(null);
    try {
      const q = await api<Quote>("/v1/quotes", { method: "POST", body: { lot_id: lotId, from, to, vehicle, promo: promo.trim().toUpperCase() } });
      setQuote(q);
      setPromoMsg(q.promo_error ? { ok: false, text: q.promo_error } : { ok: true, text: `Applied. You save ${rupees(q.discountPaise)}.` });
    } catch (x) { setPromoMsg({ ok: false, text: x instanceof ApiFailure ? x.message : "Couldn't check that code." }); }
  }

  async function collect(res: CreateBookingResponse) {
    const outcome = await pay(res.razorpay_order, { contact: me?.user.phone, method }, `${lotName} · ${res.booking.code}`);
    if (outcome === "paid") { router.push(`/passes?new=${res.booking.id}`); return; }
    setBusy(false);
    setErr(outcome === "cancelled" ? "Payment window closed. Your bay is held for 10 minutes; tap Pay to try again." : "The payment didn't go through. No money was taken. Try again or pick another method.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setAlts([]);
    const p = cleanPlate(plateValue);
    if (!PLATE.test(p)) return setErr("Enter the number plate like KA01AB1234.");
    setBusy(true);
    if (pending) return collect(pending); // retry payment on the same held bay, never a second booking
    try {
      const res = await api<CreateBookingResponse>("/v1/bookings", {
        method: "POST", idempotent: true,
        body: { lot_id: lotId, from, to, vehicle_kind: vehicle, plate: p, promo: quote.promoCode ?? undefined }
      });
      setPending(res);
      await collect(res);
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiFailure) { setErr(x.message); setAlts(x.body.alternatives ?? []); }
      else setErr("Something went wrong. Try again in a minute.");
    }
  }

  if (me === null) return (
    <div className="checkout card">
      <Bill q={quote} />
      <SignIn title="Sign in to book" onDone={reload} />
    </div>
  );

  return (
    <form className="checkout card" onSubmit={submit} noValidate aria-label="Book this lot">
      <div>
        <span className="label">Your booking</span>
        <p style={{ margin: "4px 0 0", fontWeight: 700 }}>{when(from)} → {when(to)}</p>
      </div>
      <Bill q={quote} />
      <div className="field">
        <label htmlFor="promo">Promo code</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="promo" className="input mono" value={promo} onChange={e => setPromo(e.target.value.toUpperCase())} placeholder="FIRST50" maxLength={20} aria-describedby="promo-msg" />
          <button type="button" className="btn ghost" onClick={applyPromo}>Apply</button>
        </div>
        <span id="promo-msg" className={promoMsg?.ok ? "okmsg" : "err"} role="status">{promoMsg?.text}</span>
      </div>
      <div className="field">
        <label htmlFor="plate">Number plate</label>
        <input id="plate" className="input mono" value={plateValue} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="KA01AB1234" autoComplete="off" maxLength={13} />
      </div>
      <fieldset className="pay" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Pay with</legend>
        {METHODS.map(m => (
          <label key={m.id}><input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
            <span><strong>{m.label}</strong> <span className="muted">· {m.sub}</span></span></label>
        ))}
      </fieldset>
      <p className="err" role="alert">{err}</p>
      {alts && alts.length > 0 && (
        <div className="field"><span className="label">Nearby with space</span>
          {alts.map(a => <Link key={a.id} className="list-row" href={`/lots/${a.id}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&vehicle=${vehicle}`}>{a.name}<span aria-hidden>→</span></Link>)}
        </div>
      )}
      <button className="btn block" disabled={busy || full || me === undefined}>
        {full ? "Full for these times" : busy ? "Opening payment…" : `Pay ${rupees(quote.totalPaise)}`}
      </button>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>GST invoice sent to your phone. Free cancellation up to 1 hour before arrival.</p>
      <div className="mobilebar">
        <div><b className="num" style={{ fontSize: 20 }}>{rupees(quote.totalPaise)}</b><br /><span className="muted" style={{ fontSize: 13 }}>incl. GST</span></div>
        <button className="btn" disabled={busy || full || me === undefined}>{busy ? "Paying…" : "Pay"}</button>
      </div>
    </form>
  );
}
