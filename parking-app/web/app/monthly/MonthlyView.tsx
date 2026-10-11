"use client";
import { useEffect, useState } from "react";
import { Bill } from "@/components/Bill";
import { OtpStep } from "@/components/OtpStep";
import { useSession } from "@/components/hooks";
import { api, ApiFailure } from "@/lib/api";
import type { MonthlyRow } from "@/lib/contract";
import { KIND_LABEL, inr, km, normPlate, PHONE_ERR, PHONE_RE, PLATE_ERR, PLATE_RE, timings } from "@/lib/format";
import { AREAS, areaBySlug } from "@/lib/places";
import { local } from "@/lib/session";
import { track } from "@/lib/track";

function firstOfNextMonthIST(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

/** S06 Monthly: MON-01 request. Approval and the payment link (MON-02, MON-03) arrive with the ops stage. */
export function MonthlyView() {
  const session = useSession();
  const [area, setArea] = useState(AREAS[0]);
  const [rows, setRows] = useState<MonthlyRow[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<MonthlyRow | null>(null);
  const [plate, setPlate] = useState("");
  const [phone, setPhone] = useState("");
  const [start, setStart] = useState(firstOfNextMonthIST());
  const [formErr, setFormErr] = useState("");
  const [otp, setOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => { setArea(areaBySlug(local<string>("area"))); }, []);
  useEffect(() => {
    setRows(null); setErr("");
    api.monthlyLots(area.lat, area.lng).then(setRows).catch(e => setErr(e instanceof ApiFailure ? e.message : "Couldn't load monthly lots."));
  }, [area]);
  useEffect(() => { if (session) setPhone(session.user.phone.replace(/^\+91/, "")); }, [session]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!PLATE_RE.test(normPlate(plate))) { setFormErr(PLATE_ERR); return; }
    if (!PHONE_RE.test(phone)) { setFormErr(PHONE_ERR); return; }
    if (!start) { setFormErr("Pick a start date."); return; }
    setFormErr("");
    if (!session || session.user.phone !== "+91" + phone) { setOtp(true); return; }
    void send();
  }

  async function send() {
    if (!open) return;
    setBusy(true); setFormErr("");
    try {
      const p = normPlate(plate);
      let vehicleId: string;
      try { vehicleId = (await api.addVehicle(p, "car")).vehicle.id; }
      catch (e) {
        if (!(e instanceof ApiFailure && e.code === "duplicate_vehicle")) throw e;
        const v = (await api.me()).vehicles.find(x => x.plate === p);
        if (!v) throw e;
        vehicleId = v.id;
      }
      const r = await api.requestMonthly({ lot_id: open.lot.id, vehicle_id: vehicleId, starts_on: start });
      track("monthly_requested", { lot_id: open.lot.id });
      setDone(r.message); setOpen(null);
    } catch (e) { setFormErr(e instanceof ApiFailure ? e.message : "Couldn't send the request. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <div className="intro"><h1>Monthly parking</h1><p>One fixed fee for unlimited entries at one lot. Request a pass and the lot operator confirms your bay within one working day.</p></div>
      <div className="field" style={{ maxWidth: 320, marginTop: 14 }}><label htmlFor="m-area">Near</label>
        <select id="m-area" value={area.slug} onChange={e => setArea(areaBySlug(e.target.value))}>{AREAS.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></div>
      <div className="ok" role="status" style={{ marginTop: 10 }}>{done}</div>
      <div className="mgrid" aria-live="polite">
        {err ? <div className="errbox" role="alert">{err}</div> :
          rows === null ? [0, 1, 2].map(i => <div key={i} className="skel" aria-hidden="true" />) :
          rows.length === 0 ? <div className="empty">No monthly lots near {area.name} yet. Try another area.</div> :
          rows.map(r => (
            <div className="mcard" key={r.lot.id}>
              <h3>{r.lot.name}</h3>
              <div style={{ color: "var(--muted)", fontSize: 13 }}><span className="lotcode">{r.lot.code}</span> {km(r.distance_m)} · {KIND_LABEL[r.lot.kind] ?? r.lot.kind} · {timings(r.lot)}</div>
              <div><b className="num">{inr(r.monthly_paise)}</b> <span style={{ color: "var(--muted)", fontSize: 13 }}>/ month + 18% GST ({inr(r.gst_paise)})</span></div>
              <button className="btn ghost" type="button" onClick={() => { setOpen(r); setOtp(false); setDone(""); }}>Request monthly pass</button>
            </div>))}
      </div>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(null)} />
          <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="m-title" onKeyDown={e => e.key === "Escape" && setOpen(null)}>
            <button className="close" type="button" onClick={() => setOpen(null)} autoFocus>Close</button>
            <span className="tag" style={{ color: "var(--sign)" }}>Monthly pass</span>
            <h2 id="m-title">{open.lot.name}</h2>
            <Bill q={{ hours: 0, ratePaise: 0, basePaise: open.monthly_paise, discountPaise: 0, feePaise: 0, gstPaise: open.gst_paise, totalPaise: open.total_paise, promoCode: null }} />
            {otp ? <div style={{ marginTop: 16 }}><OtpStep phone={phone} onChangePhone={() => setOtp(false)} onDone={() => { setOtp(false); void send(); }} /></div> : (
              <form className="stack" onSubmit={submit} noValidate>
                <div className="field"><label htmlFor="m-vno">Vehicle number</label><input id="m-vno" style={{ textTransform: "uppercase" }} placeholder="KA 01 AB 1234" value={plate} onChange={e => setPlate(e.target.value)} /></div>
                <div className="field"><label htmlFor="m-mob">Mobile number</label><input id="m-mob" inputMode="numeric" maxLength={10} value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
                <div className="field"><label htmlFor="m-start">Start date</label><input type="date" id="m-start" value={start} onChange={e => setStart(e.target.value)} /></div>
                <div className="err" role="alert">{formErr}</div>
                <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Send request to operator"}</button>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>You pay only after the operator confirms a bay. Billing is due by the 5th of each month; entry pauses if it&apos;s unpaid after the 7th.</div>
              </form>
            )}
          </aside>
        </>
      )}
    </section>
  );
}
