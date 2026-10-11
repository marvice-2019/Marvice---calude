"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { clock, relative, rupees, when } from "@/lib/format";
import { pay } from "@/lib/pay";
import type { Booking, RazorpayOrder } from "@/lib/types";
import { Qr } from "./Qr";
import { SignIn } from "./SignIn";
import { useNow } from "./useNow";

const CACHE = "bl_passes";
const LIVE = ["confirmed", "checked_in"];

export function Passes() {
  const fresh = useSearchParams().get("new");
  const [list, setList] = useState<Booking[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "signin" | "error" | "offline">("loading");
  const [waiting, setWaiting] = useState(!!fresh), [toast, setToast] = useState("");
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const rows = await api<Booking[]>("/v1/bookings");
      setList(rows); setState("ok");
      try { localStorage.setItem(CACHE, JSON.stringify(rows.filter(b => LIVE.includes(b.status)))); } catch { /* storage off */ }
      return rows;
    } catch (x) {
      if (x instanceof ApiFailure && x.status === 401) setState("signin");
      else {
        let cached: Booking[] = [];
        try { cached = JSON.parse(localStorage.getItem(CACHE) ?? "[]"); } catch { /* none */ }
        if (cached.length) { setList(cached); setState("offline"); } else setState("error");
      }
      return null;
    }
  }, []);

  // After checkout the webhook issues the pass; poll until it shows (late webhooks are normal).
  useEffect(() => {
    let n = 0, stop = false;
    const tick = async () => {
      const rows = await load();
      if (stop || !fresh) return;
      if (rows?.some(b => b.id === fresh && LIVE.includes(b.status))) { setWaiting(false); setToast("Paid. Your pass is ready."); return; }
      if (++n < 20) setTimeout(tick, 1500); else setWaiting(false);
    };
    tick();
    return () => { stop = true; };
  }, [fresh, load]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);

  if (state === "signin") return <div style={{ maxWidth: 460 }}><SignIn title="Sign in to see your passes" onDone={load} /></div>;
  if (state === "loading") return <div className="tickets"><div className="skel" style={{ height: 420 }} /><div className="skel" style={{ height: 420 }} /></div>;
  if (state === "error") return <div className="empty card"><h3>Couldn&apos;t load your passes</h3><p>Check your connection and try again.</p><button className="btn" onClick={load}>Try again</button></div>;

  const upcoming = (list ?? []).filter(b => LIVE.includes(b.status) && Date.parse(b.to) > now);
  const past = (list ?? []).filter(b => !upcoming.includes(b));

  return (
    <>
      {state === "offline" && <p className="offline card" role="status">Showing saved passes. Extend and cancel need a connection.</p>}
      {waiting && <p className="card panel" role="status"><span className="status live">Confirming payment…</span> This usually takes a few seconds.</p>}
      {upcoming.length === 0 && !waiting && (
        <div className="empty card">
          <h3>No upcoming passes</h3><p>Book a bay and your pass appears here, ready for the gate.</p>
          <Link className="btn" href="/">Find parking</Link>
        </div>
      )}
      <div className="tickets">{upcoming.map((b, i) => <Ticket key={b.id} b={b} i={i} now={now} onChange={load} toast={setToast} offline={state === "offline"} />)}</div>
      {past.length > 0 && (
        <section style={{ marginTop: 32 }} aria-labelledby="past-h">
          <h2 id="past-h" style={{ fontSize: 26, marginBottom: 10 }}>Past and cancelled</h2>
          <div className="card panel">
            {past.slice(0, 20).map(b => (
              <div key={b.id} className="list-row">
                <span><strong>{b.lot_name}</strong><br /><span className="muted" style={{ fontSize: 14 }}>{when(b.from)} · {b.code} · {b.status.replace("_", " ")}</span></span>
                <span className="num">{rupees(b.total_paise)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function Ticket({ b, i, now, onChange, toast, offline }: { b: Booking; i: number; now: number; onChange: () => void; toast: (s: string) => void; offline: boolean }) {
  const start = Date.parse(b.from), end = Date.parse(b.to);
  const live = now >= start && now < end;
  const pct = live ? Math.round(((now - start) / (end - start)) * 100) : 0;
  const cancellable = now < start - 3_600_000;
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [spotOpen, setSpotOpen] = useState(false);

  async function extend() {
    setBusy("extend"); setErr("");
    try {
      const r = await api<{ new_end: string; amount_paise: number; razorpay_order: RazorpayOrder }>(`/v1/bookings/${b.id}/extend`, { method: "POST", idempotent: true });
      const out = await pay(r.razorpay_order, { contact: b.phone }, `Extend ${b.code} by 1 hour`);
      if (out === "paid") { toast(`Extended to ${clock(r.new_end)}.`); setTimeout(onChange, 1500); } else setErr("Extension not paid. Your pass is unchanged.");
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't extend. Try again."); }
    setBusy("");
  }
  async function cancel() {
    if (!confirm(`Cancel ${b.code}? You get a full refund of ${rupees(b.total_paise)}.`)) return;
    setBusy("cancel"); setErr("");
    try {
      const r = await api<{ refund: { message: string } }>(`/v1/bookings/${b.id}/cancel`, { method: "POST", idempotent: true });
      toast(r.refund.message); onChange();
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't cancel. Try again."); }
    setBusy("");
  }

  return (
    <article className="ticket rise" style={{ "--i": i } as React.CSSProperties} aria-label={`Pass ${b.code} for ${b.lot_name}`}>
      <header>
        <span className="code">{b.lot_code.replace(/^BLR/, "")}</span>
        <h3>{b.lot_name}</h3>
        <span style={{ opacity: .85, fontSize: 14 }}>{when(b.from)} → {clock(b.to)}</span>
      </header>
      <div className="body">
        <span className={`status${live ? " live" : ""}`}>{live ? `Parked · ${relative(end - now)} left` : `Starts ${when(b.from)}`}</span>
        <Qr value={b.code} label={`Gate QR for pass ${b.code}`} />
        <p className="mono" style={{ textAlign: "center", margin: 0, fontSize: 20, letterSpacing: ".12em" }}>{b.code}</p>
        {live && <div className="prog" aria-label={`${pct}% of your time used`}><i style={{ width: `${pct}%` }} /></div>}
        <dl className="kv">
          <dt>Vehicle</dt><dd className="mono">{b.plate}</dd>
          <dt>Paid</dt><dd className="num">{rupees(b.total_paise)} <span className="muted">(GST {rupees(b.gst_paise)})</span></dd>
          {b.spot && <><dt>Your spot</dt><dd>{[b.spot.floor && `Floor ${b.spot.floor}`, b.spot.bay && `Bay ${b.spot.bay}`, b.spot.note].filter(Boolean).join(" · ")}</dd></>}
        </dl>
        <p className="err" role="alert">{err}</p>
        {!offline && (
          <div className="row">
            {live && <button className="btn" onClick={extend} disabled={!!busy}>{busy === "extend" ? "…" : "+1 hour"}</button>}
            <button className="btn ghost" onClick={() => setSpotOpen(o => !o)} aria-expanded={spotOpen}>{b.spot ? "Edit spot" : "Mark my spot"}</button>
            {cancellable && <button className="btn ghost" onClick={cancel} disabled={!!busy}>{busy === "cancel" ? "…" : "Cancel"}</button>}
          </div>
        )}
        {spotOpen && <SpotForm b={b} onSaved={() => { setSpotOpen(false); toast("Spot saved. We'll show it when you come back."); onChange(); }} />}
      </div>
    </article>
  );
}

function SpotForm({ b, onSaved }: { b: Booking; onSaved: () => void }) {
  const [floor, setFloor] = useState(b.spot?.floor ?? ""), [bay, setBay] = useState(b.spot?.bay ?? ""), [note, setNote] = useState(b.spot?.note ?? "");
  const [err, setErr] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { await api(`/v1/bookings/${b.id}/spot`, { method: "POST", body: { floor, bay, note } }); onSaved(); }
    catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't save. Try again."); }
  }
  return (
    <form onSubmit={save} className="panel" style={{ padding: 0 }} aria-label="Mark my spot">
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor={`f-${b.id}`}>Floor</label><input id={`f-${b.id}`} className="input" value={floor} maxLength={6} onChange={e => setFloor(e.target.value)} placeholder="B2" /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor={`b-${b.id}`}>Bay</label><input id={`b-${b.id}`} className="input" value={bay} maxLength={8} onChange={e => setBay(e.target.value)} placeholder="47" /></div>
      </div>
      <div className="field"><label htmlFor={`n-${b.id}`}>Note</label><input id={`n-${b.id}`} className="input" value={note} maxLength={80} onChange={e => setNote(e.target.value)} placeholder="Near the blue pillar, lift C" /></div>
      <p className="err" role="alert">{err}</p>
      <button className="btn block">Save spot</button>
    </form>
  );
}
