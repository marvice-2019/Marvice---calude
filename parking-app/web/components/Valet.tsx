"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { clock, km, relative, rupees } from "@/lib/format";
import { pay } from "@/lib/pay";
import type { ValetDesk, ValetRequestResponse, ValetTicket } from "@/lib/types";
import { SignIn } from "./SignIn";
import { useNow } from "./useNow";

const STEPS: { s: ValetTicket["status"]; label: string; sub: string }[] = [
  { s: "dropped", label: "Keys handed over", sub: "4 photos taken at the porch" },
  { s: "parked", label: "Parked", sub: "Your car is in a bay" },
  { s: "requested", label: "Requested", sub: "The desk has your request" },
  { s: "coming", label: "On the way", sub: "A valet is bringing your car" },
  { s: "ready", label: "At the porch", sub: "Show your ticket code" }
];
const ORDER = STEPS.map(x => x.s);
const TIPS = [0, 2000, 5000, 10000];

async function fetchTickets(): Promise<{ tickets: ValetTicket[] | null; signin: boolean; err: string }> {
  try { return { tickets: await api<ValetTicket[]>("/v1/valet/tickets"), signin: false, err: "" }; }
  catch (x) { return x instanceof ApiFailure && x.status === 401 ? { tickets: null, signin: true, err: "" } : { tickets: null, signin: false, err: "Couldn't load your valet tickets." }; }
}

export function Valet() {
  const [tickets, setTickets] = useState<ValetTicket[] | null>(null), [signin, setSignin] = useState(false), [err, setErr] = useState("");
  const [desks, setDesks] = useState<ValetDesk[]>([]);

  // Results are applied in promise callbacks, never synchronously inside an effect.
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchTickets>>) => {
    setSignin(r.signin); setErr(r.err); if (r.tickets) setTickets(r.tickets);
  }, []);
  const load = useCallback(() => fetchTickets().then(apply), [apply]);

  useEffect(() => {
    let live = true;
    fetchTickets().then(r => { if (live) apply(r); });
    api<ValetDesk[]>("/v1/valet/desks?lat=12.9716&lng=77.5946").then(d => { if (live) setDesks(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [apply]);
  // Live tracker: refresh while a car is being fetched.
  const moving = tickets?.some(t => t.status === "requested" || t.status === "coming");
  useEffect(() => { if (!moving) return; const t = setInterval(load, 8000); return () => clearInterval(t); }, [moving, load]);

  const open = tickets?.filter(t => t.status !== "closed" && t.status !== "cancelled") ?? [];
  return (
    <div className="grid2">
      <div>
        {signin && <div style={{ maxWidth: 460 }}><SignIn title="Sign in with the number you gave the valet" onDone={load} /></div>}
        {err && <div className="empty card"><h3>{err}</h3><button className="btn" onClick={load}>Try again</button></div>}
        {!signin && tickets === null && !err && <div className="skel" style={{ height: 380 }} />}
        {tickets && open.length === 0 && (
          <div className="empty card"><h3>No car with a valet right now</h3><p>When you hand over your keys at a Bayline desk, your ticket appears here by itself. No app download needed.</p></div>
        )}
        {open.map(t => <Ticket key={t.id} t={t} onChange={load} />)}
      </div>
      <aside className="stick">
        <div className="card panel">
          <strong>Valet desks nearby</strong>
          {desks.length === 0 && <p className="muted" style={{ margin: 0 }}>No live desks within 5 km.</p>}
          {desks.map(d => (
            <div key={d.id} className="list-row">
              <span><strong>{d.name}</strong><br /><span className="muted" style={{ fontSize: 14 }}>{km(d.distance_m)} · usually {d.typical_eta_min} min{d.validator ? ` · free with ${d.validator}` : ""}</span></span>
              <span className="num">{rupees(d.fee_paise + d.gst_paise)}</span>
            </div>
          ))}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Fees shown include 18% GST. Tips go to the valet team in full and aren&apos;t taxed or invoiced.</p>
        </div>
      </aside>
    </div>
  );
}

function Ticket({ t, onChange }: { t: ValetTicket; onChange: () => void }) {
  const now = useNow(5000);
  const [tip, setTip] = useState(2000), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const idx = ORDER.indexOf(t.status);
  const canRequest = t.status === "dropped" || t.status === "parked";
  const eta = t.eta_at && now ? Date.parse(t.eta_at) - now : null;

  async function request(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await api<ValetRequestResponse>(`/v1/valet/tickets/${t.id}/request`, { method: "POST", idempotent: true, body: { tip_paise: tip, validation_code: code.trim() || undefined } });
      if (r.razorpay_order) {
        const out = await pay(r.razorpay_order, { contact: t.phone }, `Valet ${t.code}`);
        if (out !== "paid") setErr("Payment didn't go through. Your car is still requested; pay at the desk if you prefer.");
      }
      onChange();
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't request your car. Try again."); }
    setBusy(false);
  }
  const total = t.validated ? tip : t.fee_paise + Math.round(t.fee_paise * 0.18) + tip;

  return (
    <article className="ticket rise" style={{ marginBottom: 18 }} aria-label={`Valet ticket ${t.code}`}>
      <header>
        <span className="code">{t.code}</span>
        <h3>{t.desk_name}</h3>
        <span style={{ opacity: .85, fontSize: 14 }}>Key tag {t.key_tag} · <span className="mono">{t.plate}</span></span>
      </header>
      <div className="body">
        {(t.status === "requested" || t.status === "coming") && (
          <div aria-live="polite"><span className="label">Arriving in</span><div className="eta num">{eta !== null ? relative(eta) : `${t.typical_eta_min} min`}</div></div>
        )}
        {t.status === "ready" && <div aria-live="polite"><span className="status live">At the porch now</span></div>}
        <ol className="tl">
          {STEPS.map((s, i) => (
            <li key={s.s} className={i < idx ? "done" : i === idx ? "now" : ""} aria-current={i === idx ? "step" : undefined}>
              <span>{s.label}<small>{s.s === "dropped" ? `${clock(t.dropped_at)} · ${s.sub}` : s.s === "parked" && t.bay ? `Bay ${t.bay}` : s.sub}</small></span>
            </li>
          ))}
        </ol>
        {t.handover_photos.length > 0 && (
          <div className="photos" aria-label="Handover photos">{["Front", "Rear", "Left", "Right"].map(s => <span key={s}>{s}</span>)}</div>
        )}
        {canRequest && (
          <form onSubmit={request} className="panel" style={{ padding: 0 }}>
            <div className="field">
              <span className="label" id={`tip-${t.id}`}>Tip the valet team</span>
              <div className="chips" role="group" aria-labelledby={`tip-${t.id}`}>
                {TIPS.map(v => <button key={v} type="button" className="chip soft" aria-pressed={tip === v} onClick={() => setTip(v)}>{v ? rupees(v) : "No tip"}</button>)}
              </div>
            </div>
            <div className="field"><label htmlFor={`vc-${t.id}`}>Validation code (restaurant or store)</label>
              <input id={`vc-${t.id}`} className="input mono" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="Optional" /></div>
            <div className="bill">
              <div><span>Valet fee</span><span>{t.validated || code ? "Validated*" : rupees(t.fee_paise)}</span></div>
              {!(t.validated || code) && <div><span>GST 18%</span><span>{rupees(Math.round(t.fee_paise * 0.18))}</span></div>}
              <div><span>Tip (no GST)</span><span>{rupees(tip)}</span></div>
              <div className="tot"><span>You pay</span><span>{code ? "Checked on request" : rupees(total)}</span></div>
            </div>
            <p className="err" role="alert">{err}</p>
            <button className="btn kerb block" disabled={busy}>{busy ? "Requesting…" : "Bring my car"}</button>
          </form>
        )}
      </div>
    </article>
  );
}
