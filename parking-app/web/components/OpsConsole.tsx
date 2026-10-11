"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { clock, rupees, when } from "@/lib/format";
import type { Arrival, Dashboard, LotStatus, MonthlyRow, OpsLot, Payout, RateCard } from "@/lib/types";
import { HourChart } from "./HourChart";
import { SignIn } from "./SignIn";
import { useMe } from "./useMe";

const STATUSES: { s: LotStatus; label: string }[] = [{ s: "open", label: "Open" }, { s: "full", label: "Full" }, { s: "gate_down", label: "Gate down" }, { s: "closed", label: "Closed" }];
const OPS_ROLES = ["operator_staff", "operator_admin", "platform_admin"];

function todayRange() {
  // IST calendar day as UTC instants
  const ist = new Date(Date.now() + 330 * 60_000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() };
}

export function OpsConsole() {
  const { me, reload } = useMe();
  const [lots, setLots] = useState<OpsLot[] | null>(null), [lotId, setLotId] = useState(""), [err, setErr] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!me || !OPS_ROLES.includes(me.user.role)) return;
    let live = true;
    api<OpsLot[]>("/v1/ops/lots").then(l => { if (live) { setLots(l); setLotId(id => id || l[0]?.id || ""); } })
      .catch(x => { if (live) setErr(x instanceof ApiFailure ? x.message : "Couldn't load your lots."); });
    return () => { live = false; };
  }, [me, nonce]);

  if (me === undefined) return <div className="skel" style={{ height: 300 }} />;
  if (me === null) return <div style={{ maxWidth: 460 }}><SignIn title="Operator sign-in" onDone={reload} /></div>;
  if (!OPS_ROLES.includes(me.user.role)) return (
    <div className="empty card"><h3>This console is for parking operators</h3><p>Your number isn&apos;t linked to a lot. Ask your operator admin to add you, or <a className="link" href="/list-your-space">list your space</a>.</p></div>
  );
  if (err) return <div className="empty card"><h3>{err}</h3></div>;
  if (!lots) return <div className="skel" style={{ height: 300 }} />;
  if (!lots.length) return <div className="empty card"><h3>No lots yet</h3><p>Lots appear here once Bayline onboards them for your company.</p></div>;

  const lot = lots.find(l => l.id === lotId) ?? lots[0];
  const isAdmin = lot.my_role === "operator_admin" || lot.my_role === "platform_admin";
  return (
    <>
      <div className="chips" role="group" aria-label="Lot" style={{ marginBottom: 14 }}>
        {lots.map(l => <button key={l.id} className="chip" aria-pressed={l.id === lot.id} onClick={() => setLotId(l.id)}>{l.code.replace(/^BLR/, "")} · {l.name}</button>)}
      </div>
      <LotPanel key={lot.id} lot={lot} isAdmin={isAdmin} onChanged={() => setNonce(n => n + 1)} />
    </>
  );
}

function LotPanel({ lot, isAdmin, onChanged }: { lot: OpsLot; isAdmin: boolean; onChanged: () => void }) {
  const [tab, setTab] = useState<"today" | "rates" | "monthly" | "payouts">("today");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);

  async function setStatus(status: LotStatus) {
    if (status === lot.status) return;
    if (status !== "open" && !confirm(`Mark ${lot.name} as ${status.replace("_", " ")}? Drivers with passes in the next 3 hours get a WhatsApp notice.`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await api<{ notified: number }>(`/v1/ops/lots/${lot.id}/status`, { method: "PUT", body: { status } });
      setMsg(status === "open" ? "Lot is open." : `Status set. ${r.notified} driver${r.notified === 1 ? "" : "s"} notified.`); onChanged();
    } catch (x) { setMsg(x instanceof ApiFailure ? x.message : "Couldn't change status."); }
    setBusy(false);
  }

  return (
    <section className="panel card" aria-label={lot.name}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><span className="code">{lot.code.replace(/^BLR/, "")}</span><h2 style={{ fontSize: 30, marginTop: 6 }}>{lot.name}</h2><p className="muted" style={{ margin: 0 }}>{lot.address} · {lot.operator}</p></div>
        <div>
          <span className="label" id="st-l">Lot status</span>
          <div className="statusbar" role="group" aria-labelledby="st-l" style={{ marginTop: 6 }}>
            {STATUSES.map(x => <button key={x.s} data-s={x.s} aria-pressed={lot.status === x.s} disabled={busy} onClick={() => setStatus(x.s)}>{x.label}</button>)}
          </div>
        </div>
      </div>
      {msg && <p className="okmsg" role="status">{msg}</p>}
      <div className="tabs" role="tablist">
        {([["today", "Today"], ["rates", "Rates"], ...(isAdmin ? [["monthly", "Monthly"], ["payouts", "Payouts"]] : [])] as [typeof tab, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "today" && <Today lot={lot} isAdmin={isAdmin} />}
      {tab === "rates" && <Rates lot={lot} isAdmin={isAdmin} />}
      {tab === "monthly" && isAdmin && <Monthly lotId={lot.id} />}
      {tab === "payouts" && isAdmin && <Payouts />}
    </section>
  );
}

function Today({ lot, isAdmin }: { lot: OpsLot; isAdmin: boolean }) {
  const [arrivals, setArrivals] = useState<Arrival[] | null>(null), [dash, setDash] = useState<Dashboard | null>(null);
  useEffect(() => {
    let live = true;
    api<Arrival[]>(`/v1/ops/lots/${lot.id}/arrivals`).then(a => { if (live) setArrivals(a); }).catch(() => { if (live) setArrivals([]); });
    if (isAdmin) {
      const { from, to } = todayRange();
      api<Dashboard>(`/v1/ops/dashboard?lot_id=${lot.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(d => { if (live) setDash(d); }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [lot.id, isAdmin]);
  const parked = arrivals?.filter(a => a.status === "checked_in") ?? [], expected = arrivals?.filter(a => a.status === "confirmed") ?? [];

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="kpis">
        <div className="kpi"><b>{lot.parked_now}</b><span>parked now</span></div>
        <div className="kpi"><b>{lot.expected_today}</b><span>still expected today</span></div>
        <div className="kpi"><b>{lot.capacity_car ? Math.round((lot.parked_now * 100) / lot.capacity_car) : 0}%</b><span>of {lot.capacity_car} car bays</span></div>
        {dash && <div className="kpi"><b>{rupees(dash.revenue.gross_paise)}</b><span>parking captured today</span></div>}
        {dash && <div className="kpi"><b>{rupees(dash.revenue.net_paise)}</b><span>your share after deductions</span></div>}
      </div>
      {dash && <div className="card panel"><HourChart rows={dash.by_hour} capacity={dash.capacity_car} title="Cars parked by hour, today (IST)" /></div>}
      {dash && (
        <div className="card panel">
          <strong>Today&apos;s money</strong>
          <div className="bill">
            <div><span>Parking captured (before GST)</span><span>{rupees(dash.revenue.gross_paise)}</span></div>
            <div><span>Bayline commission</span><span>−{rupees(dash.revenue.commission_paise)}</span></div>
            <div><span>GST 18% on commission</span><span>−{rupees(dash.revenue.commission_gst_paise)}</span></div>
            <div><span>TDS 194-O (0.1%)</span><span>−{rupees(dash.revenue.tds_paise)}</span></div>
            <div><span>GST TCS (0.5%)</span><span>−{rupees(dash.revenue.tcs_paise)}</span></div>
            <div className="tot"><span>Your share</span><span>{rupees(dash.revenue.net_paise)}</span></div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>GST collected from drivers on parking: {rupees(dash.revenue.gst_collected_paise)}. TDS and TCS are credited against your PAN and GSTIN; confirm treatment with your CA.</p>
        </div>
      )}
      <div className="grid2">
        <ArrivalList title={`Parked now (${parked.length})`} rows={parked} empty="Nobody checked in yet." />
        <ArrivalList title={`Expected today (${expected.length})`} rows={expected} empty="No more pre-bookings today." />
      </div>
    </div>
  );
}

function ArrivalList({ title, rows, empty }: { title: string; rows: Arrival[]; empty: string }) {
  return (
    <div className="card panel">
      <strong>{title}</strong>
      {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>{empty}</p> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Plate</th><th>Pass</th><th>Time</th></tr></thead>
          <tbody>{rows.map(a => <tr key={a.id}><td className="mono">{a.plate}</td><td className="mono">{a.code}</td><td>{clock(a.from)}–{clock(a.to)}{a.source === "park_now" ? " · Park now" : ""}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Rates({ lot, isAdmin }: { lot: OpsLot; isAdmin: boolean }) {
  const [rates, setRates] = useState<RateCard[] | null>(null), [nonce, setNonce] = useState(0);
  const [f, setF] = useState({ vehicle: "car", hourly: "", cap: "", monthly: "", from: "" }), [err, setErr] = useState(""), [ok, setOk] = useState("");
  useEffect(() => { let live = true; api<RateCard[]>(`/v1/ops/lots/${lot.id}/rates`).then(r => { if (live) setRates(r); }).catch(() => { if (live) setRates([]); }); return () => { live = false; }; }, [lot.id, nonce]);
  const toPaise = (v: string) => (v.trim() ? Math.round(Number(v) * 100) : null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setOk("");
    const hourly = toPaise(f.hourly);
    if (!hourly || hourly < 100) return setErr("Hourly rate must be at least ₹1.");
    if (!f.from) return setErr("Pick when the new rate starts.");
    try {
      await api(`/v1/ops/lots/${lot.id}/rates`, { method: "POST", body: { vehicle: f.vehicle, hourly_paise: hourly, daily_cap_paise: toPaise(f.cap), monthly_paise: toPaise(f.monthly), valid_from: new Date(f.from + ":00+05:30").toISOString() } });
      setOk("New rate saved. Bookings made before it starts keep their old price."); setNonce(n => n + 1);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't save the rate."); }
  }

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Vehicle</th><th className="r">Per hour</th><th className="r">Daily cap</th><th className="r">Monthly</th><th>From</th><th>Until</th></tr></thead>
        <tbody>{rates?.map(r => (
          <tr key={r.id}><td>{r.vehicle} {r.current && <span className="pill ok">current</span>}</td><td className="r">{rupees(r.hourly_paise)}</td>
            <td className="r">{r.daily_cap_paise ? rupees(r.daily_cap_paise) : "8 × hourly"}</td><td className="r">{r.monthly_paise ? rupees(r.monthly_paise) : "—"}</td>
            <td>{r.valid_from ? when(r.valid_from) : "always"}</td><td>{r.valid_to ? when(r.valid_to) : "open-ended"}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Rates are before GST. Drivers see them plus the ₹15 platform fee and 18% GST.</p>
      {isAdmin ? (
        <form className="card panel" onSubmit={save} noValidate>
          <strong>Schedule a new rate</strong>
          <div className="formrow">
            <div className="field"><label htmlFor="rv">Vehicle</label><select id="rv" className="input" value={f.vehicle} onChange={e => setF({ ...f, vehicle: e.target.value })}><option value="car">Car</option><option value="bike">Bike</option></select></div>
            <div className="field"><label htmlFor="rh">Per hour (₹)</label><input id="rh" className="input" inputMode="decimal" value={f.hourly} onChange={e => setF({ ...f, hourly: e.target.value })} /></div>
            <div className="field"><label htmlFor="rc">Daily cap (₹, optional)</label><input id="rc" className="input" inputMode="decimal" value={f.cap} onChange={e => setF({ ...f, cap: e.target.value })} /></div>
            <div className="field"><label htmlFor="rm">Monthly (₹, optional)</label><input id="rm" className="input" inputMode="decimal" value={f.monthly} onChange={e => setF({ ...f, monthly: e.target.value })} /></div>
            <div className="field"><label htmlFor="rf">Starts (IST)</label><input id="rf" type="datetime-local" className="input" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></div>
          </div>
          <p className="err" role="alert">{err}</p>{ok && <p className="okmsg" role="status">{ok}</p>}
          <button className="btn">Save rate</button>
        </form>
      ) : <p className="muted">Only your operator admin can change rates.</p>}
    </div>
  );
}

function Monthly({ lotId }: { lotId: string }) {
  const [rows, setRows] = useState<MonthlyRow[] | null>(null), [bays, setBays] = useState<Record<string, string>>({}), [msg, setMsg] = useState(""), [nonce, setNonce] = useState(0);
  useEffect(() => { let live = true; api<MonthlyRow[]>("/v1/ops/monthly-passes").then(r => { if (live) setRows(r.filter(x => x.lot_id === lotId)); }).catch(() => { if (live) setRows([]); }); return () => { live = false; }; }, [lotId, nonce]);
  async function approve(id: string) {
    const bay = (bays[id] ?? "").trim();
    if (!bay) return setMsg("Enter the bay number first.");
    try { await api(`/v1/ops/monthly-passes/${id}/approve`, { method: "POST", idempotent: true, body: { bay_label: bay } }); setMsg("Approved. The driver gets a payment link on WhatsApp."); setNonce(n => n + 1); }
    catch (x) { setMsg(x instanceof ApiFailure ? x.message : "Couldn't approve."); }
  }
  if (!rows) return <div className="skel" />;
  if (!rows.length) return <p className="muted">No monthly requests or passes for this lot.</p>;
  return (
    <div className="panel" style={{ padding: 0 }}>
      {msg && <p className="okmsg" role="status">{msg}</p>}
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Plate</th><th>Driver</th><th>Starts</th><th className="r">Price</th><th>Status</th><th>Bay</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}><td className="mono">{r.plate}</td><td className="mono">{r.phone_masked}</td><td>{r.starts_on.slice(0, 10)}</td><td className="r">{rupees(r.price_paise)}</td>
            <td><span className={`pill ${r.status === "active" ? "ok" : r.status === "requested" ? "info" : r.status === "paused_unpaid" ? "warn" : ""}`}>{r.status.replace("_", " ")}</span></td>
            <td>{r.status === "requested" ? (
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <label className="sr" htmlFor={`bay-${r.id}`}>Bay for {r.plate}</label>
                <input id={`bay-${r.id}`} className="input" style={{ minWidth: 80 }} placeholder="B2-14" value={bays[r.id] ?? ""} onChange={e => setBays({ ...bays, [r.id]: e.target.value })} />
                <button className="btn" onClick={() => approve(r.id)}>Approve</button>
              </div>) : (r.bay_label ?? "—")}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function Payouts() {
  const [rows, setRows] = useState<Payout[] | null>(null);
  const load = useCallback(() => api<Payout[]>("/v1/ops/payouts"), []);
  useEffect(() => { let live = true; load().then(r => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); }); return () => { live = false; }; }, [load]);
  if (!rows) return <div className="skel" />;
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0 }}>Weekly, Monday to Sunday (IST). Paid to your bank through Razorpay.</p>
        <a className="btn ghost" href="/api/bff/v1/ops/payouts?format=csv" download>Download CSV</a>
      </div>
      {rows.length === 0 ? <p className="muted">No payouts yet. The first one is calculated the Monday after your first booking.</p> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Week</th><th className="r">Gross</th><th className="r">Commission</th><th className="r">GST on it</th><th className="r">TDS</th><th className="r">TCS</th><th className="r">Net</th><th>Status</th></tr></thead>
          <tbody>{rows.map(p => (
            <tr key={p.id}><td>{p.period_start.slice(0, 10)} – {p.period_end.slice(0, 10)}</td><td className="r">{rupees(p.gross_paise)}</td><td className="r">{rupees(p.commission_paise)}</td>
              <td className="r">{rupees(p.commission_gst_paise)}</td><td className="r">{rupees(p.tds_paise)}</td><td className="r">{rupees(p.tcs_paise)}</td><td className="r"><strong>{rupees(p.net_paise)}</strong></td>
              <td><span className={`pill ${p.status === "paid" ? "ok" : p.status === "failed" ? "warn" : "info"}`}>{p.status}</span>{p.failure_reason && <div className="muted" style={{ fontSize: 12 }}>{p.failure_reason}</div>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
