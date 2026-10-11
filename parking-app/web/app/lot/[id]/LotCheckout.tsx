"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bill } from "@/components/Bill";
import { Gateway, type GatewayResult } from "@/components/Gateway";
import { OtpStep } from "@/components/OtpStep";
import { useSession } from "@/components/hooks";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import type { ApiError, GatewayOrder, LotDetail, PayMethod, Quote, VehicleKind } from "@/lib/contract";
import { clock, inr, KIND_LABEL, normPlate, PHONE_ERR, PHONE_RE, PLATE_ERR, PLATE_RE, timings, when } from "@/lib/format";
import { local } from "@/lib/session";
import { track } from "@/lib/track";

/** `from`/`to` are fixed by the server page (for Park now: this minute + hours) so both renders agree. */
export type CheckoutParams = { id: string; vehicle: VehicleKind; from: string; to: string } & ({ mode: "prebook" } | { mode: "now"; hours: number });

const METHODS: [PayMethod, string][] = [["upi", "UPI (GPay, PhonePe, Paytm)"], ["card", "Debit or credit card"], ["netbanking", "Netbanking"]];

/** S02 lot sheet + checkout: DRV-02, 04, 05, 06, 07, 08, 09 and GST-01. */
export function LotCheckout({ p, initial }: { p: CheckoutParams; initial: LotDetail | null }) {
  const router = useRouter();
  const session = useSession();
  // For Park now the API restarts the clock at pay time; these times are for display and the quote.
  const window_ = useMemo(() => ({ from: p.from, to: p.to }), [p.from, p.to]);

  const [detail, setDetail] = useState<LotDetail | null>(initial);
  const [loadErr, setLoadErr] = useState("");
  const [quote, setQuote] = useState<Quote | null>(initial?.quote ?? null);
  const [plate, setPlate] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<PayMethod>("upi");
  const [prefilled, setPrefilled] = useState(false);
  const [promo, setPromo] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>();
  const [promoErr, setPromoErr] = useState("");
  const [promoOk, setPromoOk] = useState("");
  const [saved, setSaved] = useState(false);
  const [favNote, setFavNote] = useState("");
  const [step, setStep] = useState<"form" | "otp" | "paying">("form");
  const [err, setErr] = useState("");
  const [full, setFull] = useState<ApiError["alternatives"] | null>(null);
  const [order, setOrder] = useState<{ order: GatewayOrder; bookingId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // One Idempotency-Key per distinct booking request. Retrying the same request (network drop, 5xx,
  // payment cancelled or failed) reuses it, so the API replays the same booking instead of holding
  // a second bay. A new key only when the request changes or the API definitively refused it (4xx).
  const idem = useRef<{ fp: string; key: string } | null>(null);
  const keyFor = (fp: string) => {
    if (!idem.current || idem.current.fp !== fp) idem.current = { fp, key: newIdempotencyKey() };
    return idem.current.key;
  };
  const startedAt = useRef(Date.now());

  useEffect(() => {
    track("checkout_started", { lot_id: p.id, source: p.mode });
    if (initial) return; // server already rendered it
    api.lot(p.id, { ...window_, vehicle: p.vehicle })
      .then(d => { setDetail(d); setQuote(d.quote); })
      .catch(e => setLoadErr(e instanceof ApiFailure ? e.message : "Couldn't load this lot. Try again."));
  }, [p.id, p.vehicle, p.mode, window_, initial]);

  // DRV-07: prefill from the account; otherwise from what this device used last time.
  useEffect(() => {
    if (!session) {
      const last = local<{ plate: string; phone: string }>("last");
      if (last) { setPlate(last.plate); setPhone(last.phone); }
      return;
    }
    setPhone(session.user.phone.replace(/^\+91/, ""));
    api.me().then(m => {
      setSaved(m.favourites.includes(p.id));
      const v = m.vehicles.find(x => x.id === m.preferences.vehicle_id);
      if (v) { setPlate(v.plate); setPrefilled(true); }
      if (m.preferences.payment_method) setMethod(m.preferences.payment_method);
    }).catch(() => {});
  }, [session, p.id]);

  async function applyPromo() {
    const code = promo.trim().toUpperCase();
    setPromoErr(""); setPromoOk("");
    try {
      const q = await api.quote({ lot_id: p.id, ...window_, vehicle: p.vehicle, promo: code || undefined });
      track("promo_applied", { code, valid: !q.promo_error, error: q.promo_error });
      if (q.promo_error) { setPromoErr(q.promo_error); setAppliedPromo(undefined); setQuote(q); return; }
      setQuote(q); setAppliedPromo(code || undefined);
      if (code) setPromoOk(`${code} applied. You save ${inr(q.discountPaise)}.`);
    } catch (e) { setPromoErr(e instanceof ApiFailure ? e.message : "Couldn't check that code. Try again."); }
  }

  async function toggleSave() {
    if (!session) { setFavNote("Sign in to save lots. You'll be asked when you pay, or use Account."); return; }
    const on = !saved; setSaved(on);
    try { await api.favourite(p.id, on); if (on) track("lot_saved", { lot_id: p.id }); }
    catch { setSaved(!on); setFavNote("Couldn't save. Try again."); }
  }

  function validate(): string {
    if (!PLATE_RE.test(normPlate(plate))) return PLATE_ERR;
    if (!PHONE_RE.test(phone)) return PHONE_ERR;
    return "";
  }

  async function pay(e?: React.FormEvent) {
    e?.preventDefault();
    const m = validate(); setErr(m); setFull(null);
    if (m) return;
    local("last", { plate: normPlate(plate), phone });
    // Guests verify the phone at pay time (GST-01); a different phone than the session means a new OTP.
    if (!session || session.user.phone !== "+91" + phone) { setStep("otp"); return; }
    await book();
  }

  async function book() {
    setBusy(true); setErr("");
    try {
      const body = {
        lot_id: p.id, source: p.mode === "now" ? "park_now" as const : "prebook" as const, vehicle_kind: p.vehicle,
        ...(p.mode === "now" ? { hours: p.hours } : { from: p.from, to: p.to }),
        plate: normPlate(plate), // the API reuses the driver's vehicle with this plate, or adds it
        promo: appliedPromo
      };
      const r = await api.createBooking(body, keyFor(JSON.stringify(body)));
      api.setPreferences({ payment_method: method }).catch(() => {});
      setOrder({ order: r.razorpay_order, bookingId: r.booking.id });
      setStep("paying");
    } catch (e2) {
      const f = e2 instanceof ApiFailure ? e2 : null;
      if (f && f.status >= 400 && f.status < 500) idem.current = null; // refused: nothing was booked
      if (f?.code === "lot_full") { setErr("This lot just filled up. Try a nearby lot."); setFull(f.body?.alternatives ?? []); }
      else if (f?.code === "promo_invalid") {
        // Back to the price without the promo, so the button never shows a total we won't charge.
        setPromoErr(f.message); setAppliedPromo(undefined); setPromoOk(""); if (detail) setQuote(detail.quote);
      }
      else setErr(f?.message ?? "Couldn't start the payment. Try again.");
      setStep("form");
    } finally { setBusy(false); }
  }

  const onGateway = useCallback((r: GatewayResult) => {
    const o = order; setOrder(null);
    const secs = Math.round((Date.now() - startedAt.current) / 1000);
    if (r === "success" && o) {
      track("payment_succeeded", { method, amount: o.order.amount, seconds_since_checkout_start: secs });
      router.push(`/passes/${o.bookingId}?new=1`);
      return;
    }
    track("payment_failed", { method, amount: o?.order.amount, error_code: r, seconds_since_checkout_start: secs });
    // Keep the key: paying again reopens the same order for the same held bay.
    setStep("form");
    setErr(r === "failed" ? "Payment didn't go through. You weren't charged." : "Payment cancelled. You weren't charged.");
  }, [order, method, router]);

  if (loadErr) return <div className="panelpage"><div className="errbox" role="alert">{loadErr}<Link className="btn ghost" href="/">Back to search</Link></div></div>;
  if (!detail || !quote) return <div className="panelpage" aria-busy="true"><div className="skel" style={{ height: 320 }} /><span className="sr-only">Loading lot…</span></div>;
  const l = detail.lot, now = p.mode === "now";

  return (
    <article className="panelpage">
      <Link className="back" href="/">← Back to results</Link>
      <span className="tag" style={{ color: "var(--sign)", display: "inline-block" }}>{now ? "Park now" : KIND_LABEL[l.kind] ?? l.kind}</span>
      <h1>{l.name}</h1>
      <div className="headrow"><span style={{ color: "var(--muted)" }}><span className="lotcode">{l.code}</span> {l.address}</span>
        <button className="star" type="button" aria-pressed={saved} onClick={toggleSave}>{saved ? "★ Saved" : "☆ Save lot"}</button></div>
      <div className="ok" role="status">{favNote}</div>
      <dl className="kv">
        <dt>{now ? "Starts" : "Arrive"}</dt><dd>{now ? "Now · " + clock(window_.from) : when(window_.from)}</dd>
        <dt>Leave</dt><dd>{when(window_.to)}</dd>
        <dt>Vehicle</dt><dd>{p.vehicle === "bike" ? "Two-wheeler" : "Car"}</dd>
        <dt>Timings</dt><dd>{timings(l)}</dd>
        <dt>Spots left</dt><dd className="num">{detail.spots_left} of {p.vehicle === "bike" ? l.capacity_bike : l.capacity_car}</dd>
        <dt>Facilities</dt><dd>{[l.covered && "Covered", l.ev_chargers > 0 && "EV charging", "CCTV", "Attendant"].filter(Boolean).join(", ")}</dd>
      </dl>
      <Bill q={quote} />

      {step === "otp" ? (
        <div style={{ marginTop: 16 }}><OtpStep phone={phone} onChangePhone={() => setStep("form")} onDone={() => { setStep("form"); void book(); }} /></div>
      ) : (
        <form className="stack" onSubmit={pay} noValidate aria-label="Checkout">
          {prefilled && <div className="saved-note">Filled from your last booking. Edit anything that changed.</div>}
          <div className="field"><label htmlFor="vno">Vehicle number</label>
            <input id="vno" autoComplete="off" placeholder="KA 01 AB 1234" style={{ textTransform: "uppercase" }} value={plate} onChange={e => setPlate(e.target.value)} /></div>
          <div className="field"><label htmlFor="mob">Mobile for WhatsApp pass</label>
            <input id="mob" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="field"><label htmlFor="promo">Promo code</label>
            <div className="promo"><input id="promo" autoComplete="off" placeholder="FIRST50" value={promo} onChange={e => setPromo(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void applyPromo(); } }} />
              <button type="button" onClick={applyPromo}>Apply</button></div>
            <div className="err" role="alert">{promoErr}</div><div className="ok" role="status">{promoOk}</div></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sec-h">Pay with</legend>
            <div className="pay">{METHODS.map(([v, t]) => (
              <label key={v}><input type="radio" name="pm" value={v} checked={method === v} onChange={() => setMethod(v)} /> {t}</label>
            ))}</div>
          </fieldset>
          <div className="err" role="alert">{err}</div>
          {full && full.length > 0 && (
            <div className="near" aria-label="Nearby lots">{full.map(a => (
              <Link key={a.id} className="btn ghost" href={`/lot/${a.id}?` + new URLSearchParams(p.mode === "now" ? { now: "1", hours: String(p.hours), vehicle: p.vehicle } : { from: p.from, to: p.to, vehicle: p.vehicle })}>
                <span className="lotcode">{a.code}</span> {a.name}</Link>))}</div>
          )}
          <button className="btn" type="submit" disabled={busy || step === "paying"}>{busy ? "Starting payment…" : `Pay ${inr(quote.totalPaise)} and get pass`}</button>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{now ? "Pass is live as soon as you pay. Show it at the gate or give your plate to the attendant." : "Free cancellation until your arrival time."} Overstay is charged at {inr(quote.ratePaise)}/hr plus GST at exit.</div>
        </form>
      )}
      {order && <Gateway order={order.order} contact={phone} method={method} description={`${l.name} (${l.code})`} onResult={onGateway} />}
    </article>
  );
}
