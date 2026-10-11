"use client";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { inr, PHONE_ERR, PHONE_RE } from "@/lib/format";
import { track } from "@/lib/track";

const COMMISSION_BPS = 1500; // 15%, same as the API's default

/** S08 List your space: payout calculator (OWN-01) and the proposed lead form. Integer paise math. */
export function OwnerCalc() {
  const [bays, setBays] = useState(20), [rate, setRate] = useState(40), [hrs, setHrs] = useState(12), [occ, setOcc] = useState(35);
  const grossPaise = Math.round((bays * rate * 100 * hrs * 30 * occ) / 100);
  const outPaise = grossPaise - Math.round((grossPaise * COMMISSION_BPS) / 10_000);
  const [lead, setLead] = useState({ name: "", phone: "", address: "", bays: "20" });
  const [err, setErr] = useState(""); const [ok, setOk] = useState(""); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setOk("");
    const n = Number(lead.bays);
    if (lead.name.trim().length < 2) { setErr("Enter your name."); return; }
    if (!PHONE_RE.test(lead.phone)) { setErr(PHONE_ERR); return; }
    if (lead.address.trim().length < 5) { setErr("Enter the lot address."); return; }
    if (!Number.isInteger(n) || n < 1) { setErr("Enter how many bays you can list."); return; }
    setBusy(true);
    try {
      await api.ownerLead({ name: lead.name.trim(), phone: lead.phone, address: lead.address.trim(), bays: n });
      track("owner_lead_submitted", { bays: n, payout: outPaise });
      setOk("Thanks. Our team calls you within one working day to plan a site visit.");
    } catch (e2) { setErr(e2 instanceof ApiFailure ? e2.message : "Couldn't send. Try again."); }
    finally { setBusy(false); }
  }

  const slider = (id: string, label: React.ReactNode, v: number, set: (n: number) => void, min: number, max: number, step = 1) => (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input type="range" id={id} min={min} max={max} step={step} value={v} onChange={e => { set(+e.target.value); track("owner_calc_used", { bays, payout: outPaise }); }} /></div>
  );

  return (
    <>
      <div className="owner">
        <div className="panel">
          {slider("o-bays", <>Bays you can list: <span className="num">{bays}</span></>, bays, setBays, 1, 200)}
          {slider("o-rate", <>Hourly rate (car): ₹<span className="num">{rate}</span></>, rate, setRate, 10, 150, 5)}
          {slider("o-hours", <>Hours open per day: <span className="num">{hrs}</span></>, hrs, setHrs, 4, 24)}
          {slider("o-occ", <>Expected occupancy: <span className="num">{occ}</span>%</>, occ, setOcc, 5, 90, 5)}
        </div>
        <div className="panel">
          <div className="sec-h" style={{ margin: 0 }}>Estimated monthly payout</div>
          <div className="big num" aria-live="polite">{inr(Math.round(outPaise / 100) * 100)}</div>
          <div className="formula">{bays} bays × ₹{rate}/hr × {hrs} h × 30 days × {occ}% occupancy = {inr(Math.round(grossPaise / 100) * 100)} gross, less 15% platform commission. Before GST and TDS, which apply to your payout separately. An estimate, not a promise of bookings.</div>
          <div className="sec-h" style={{ margin: "4px 0 0" }}>How listing works</div>
          <ol className="steps">
            <li>Share bay count, timings and gate photos.</li>
            <li>We verify the site and set up QR or number-plate entry.</li>
            <li>Bookings go live. Payouts reach your bank every Monday.</li>
          </ol>
        </div>
      </div>
      <form className="panel" style={{ marginTop: 20, maxWidth: 560 }} onSubmit={submit} noValidate aria-labelledby="lead-h">
        <h2 id="lead-h" style={{ margin: 0 }}>Talk to us</h2>
        <div className="field"><label htmlFor="l-name">Your name</label><input id="l-name" autoComplete="name" value={lead.name} onChange={e => setLead({ ...lead, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="l-phone">Mobile number</label><input id="l-phone" inputMode="numeric" maxLength={10} autoComplete="tel-national" value={lead.phone} onChange={e => setLead({ ...lead, phone: e.target.value.replace(/\D/g, "") })} /></div>
        <div className="field"><label htmlFor="l-addr">Lot address</label><input id="l-addr" autoComplete="street-address" value={lead.address} onChange={e => setLead({ ...lead, address: e.target.value })} /></div>
        <div className="field"><label htmlFor="l-bays">Bays</label><input id="l-bays" inputMode="numeric" value={lead.bays} onChange={e => setLead({ ...lead, bays: e.target.value.replace(/\D/g, "") })} /></div>
        <div className="err" role="alert">{err}</div><div className="ok" role="status">{ok}</div>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Request a call back"}</button>
      </form>
    </>
  );
}
