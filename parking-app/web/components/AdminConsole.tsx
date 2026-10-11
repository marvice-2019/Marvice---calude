"use client";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { rupees, when } from "@/lib/format";
import type { AdminOperator, AuditEntry, Payout, Promo } from "@/lib/types";
import { SignIn } from "./SignIn";
import { useMe } from "./useMe";

type Tab = "operators" | "payouts" | "refunds" | "promos" | "audit";

export function AdminConsole() {
  const { me, reload } = useMe();
  const [tab, setTab] = useState<Tab>("payouts");
  if (me === undefined) return <div className="skel" style={{ height: 300 }} />;
  if (me === null) return <div style={{ maxWidth: 460 }}><SignIn title="Admin sign-in" onDone={reload} /></div>;
  if (me.user.role !== "platform_admin") return <div className="empty card"><h3>Bayline staff only</h3><p>This area is for platform administrators.</p></div>;
  return (
    <>
      <div className="tabs" role="tablist">
        {([["payouts", "Payouts"], ["operators", "Operators"], ["refunds", "Refunds"], ["promos", "Promos"], ["audit", "Audit log"]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "payouts" && <Payouts />}
      {tab === "operators" && <Operators />}
      {tab === "refunds" && <Refunds />}
      {tab === "promos" && <Promos />}
      {tab === "audit" && <Audit />}
    </>
  );
}

function useList<T>(path: string, nonce: number) {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => { let live = true; api<T[]>(path).then(r => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); }); return () => { live = false; }; }, [path, nonce]);
  return rows;
}
const errText = (x: unknown, fallback: string) => (x instanceof ApiFailure ? x.message : fallback);

function lastMonday() {
  const ist = new Date(Date.now() + 330 * 60_000), day = (ist.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - day - 7)).toISOString().slice(0, 10);
}

function Payouts() {
  const [nonce, setNonce] = useState(0), [week, setWeek] = useState(lastMonday()), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");
  const rows = useList<Payout>("/v1/admin/payouts", nonce);
  async function run() {
    setBusy("run"); setMsg("");
    try { const r = await api<{ created: unknown[] }>("/v1/admin/payouts/run", { method: "POST", body: { week_start: week } }); setMsg(`${r.created.length} payout${r.created.length === 1 ? "" : "s"} created for the week of ${week}.`); setNonce(n => n + 1); }
    catch (x) { setMsg(errText(x, "Couldn't run payouts.")); }
    setBusy("");
  }
  async function transfer(p: Payout) {
    if (!confirm(`Send ${rupees(p.net_paise)} to ${p.operator} through Razorpay Route?`)) return;
    setBusy(p.id); setMsg("");
    try { await api(`/v1/admin/payouts/${p.id}/transfer`, { method: "POST" }); setMsg("Transfer started. Status turns Paid when Razorpay confirms."); setNonce(n => n + 1); }
    catch (x) { setMsg(errText(x, "Transfer failed to start.")); }
    setBusy("");
  }
  return (
    <section className="panel card">
      <div className="formrow">
        <div className="field"><label htmlFor="wk">Week starting (Monday)</label><input id="wk" type="date" className="input" value={week} onChange={e => setWeek(e.target.value)} /></div>
        <button className="btn" onClick={run} disabled={busy === "run"}>Calculate payouts</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Running a week twice is safe: existing payouts are kept. Deductions: commission at each operator&apos;s rate, 18% GST on it, 0.1% TDS (194-O), 0.5% GST TCS for GST-registered operators. Confirm with the CA before the first live run.</p>
      {msg && <p className="okmsg" role="status">{msg}</p>}
      {!rows ? <div className="skel" /> : rows.length === 0 ? <p className="muted">No payouts yet.</p> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Operator</th><th>Week</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Net</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map(p => (
            <tr key={p.id}><td>{p.operator}</td><td>{p.period_start.slice(0, 10)}</td><td className="r">{rupees(p.gross_paise)}</td>
              <td className="r">{rupees(p.gross_paise - p.net_paise)}</td><td className="r"><strong>{rupees(p.net_paise)}</strong></td>
              <td><span className={`pill ${p.status === "paid" ? "ok" : p.status === "failed" ? "warn" : "info"}`}>{p.status}</span>{p.failure_reason && <div className="muted" style={{ fontSize: 12 }}>{p.failure_reason}</div>}</td>
              <td>{(p.status === "pending" || p.status === "failed") && (p.has_account
                ? <button className="btn ghost" disabled={busy === p.id} onClick={() => transfer(p)}>{p.status === "failed" ? "Retry" : "Send"}</button>
                : <span className="muted" style={{ fontSize: 12 }}>Needs bank account</span>)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Operators() {
  const [nonce, setNonce] = useState(0), [msg, setMsg] = useState(""), [f, setF] = useState({ legal_name: "", pan: "", gstin: "", commission: "15" });
  const rows = useList<AdminOperator>("/v1/admin/operators", nonce);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try {
      await api("/v1/admin/operators", { method: "POST", body: { legal_name: f.legal_name.trim(), pan: f.pan.trim().toUpperCase(), gstin: f.gstin.trim() ? f.gstin.trim().toUpperCase() : undefined, commission_bps: Math.round(Number(f.commission) * 100) } });
      setMsg("Operator added. Next: add their lots and their Razorpay linked account."); setF({ legal_name: "", pan: "", gstin: "", commission: "15" }); setNonce(n => n + 1);
    } catch (x) { setMsg(errText(x, "Couldn't add the operator.")); }
  }
  async function account(o: AdminOperator) {
    const acc = prompt(`Razorpay linked account id for ${o.legal_name} (acc_…). Bank details stay with Razorpay; we store only this id.`, o.route_account_id ?? "acc_");
    if (!acc) return;
    try { await api(`/v1/admin/operators/${o.id}/payout-account`, { method: "PUT", body: { route_account_id: acc.trim() } }); setMsg("Payout account saved."); setNonce(n => n + 1); }
    catch (x) { setMsg(errText(x, "Couldn't save the account.")); }
  }
  return (
    <section className="panel card">
      {msg && <p className="okmsg" role="status">{msg}</p>}
      {!rows ? <div className="skel" /> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Operator</th><th>PAN</th><th>GSTIN</th><th className="r">Commission</th><th className="r">Lots (live)</th><th>Payout account</th></tr></thead>
          <tbody>{rows.map(o => (
            <tr key={o.id}><td>{o.legal_name}</td><td className="mono">{o.pan}</td><td className="mono">{o.gstin ?? <span className="pill warn">none · no TCS</span>}</td>
              <td className="r">{(o.commission_bps / 100).toFixed(1)}%</td><td className="r">{o.lots} ({o.live_lots})</td>
              <td>{o.route_account_id ? <span className="mono">{o.route_account_id}</span> : <span className="pill warn">missing</span>} <button className="link" onClick={() => account(o)}>{o.route_account_id ? "Change" : "Add"}</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <form className="card panel" onSubmit={add} noValidate>
        <strong>Onboard an operator (KYC)</strong>
        <div className="formrow">
          <div className="field"><label htmlFor="on">Legal name</label><input id="on" className="input" value={f.legal_name} onChange={e => setF({ ...f, legal_name: e.target.value })} /></div>
          <div className="field"><label htmlFor="op">PAN</label><input id="op" className="input mono" maxLength={10} value={f.pan} onChange={e => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" /></div>
          <div className="field"><label htmlFor="og">GSTIN (if registered)</label><input id="og" className="input mono" maxLength={15} value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase() })} placeholder="29ABCDE1234F1Z5" /></div>
          <div className="field"><label htmlFor="oc">Commission %</label><input id="oc" className="input" inputMode="decimal" value={f.commission} onChange={e => setF({ ...f, commission: e.target.value })} /></div>
        </div>
        <button className="btn">Add operator</button>
      </form>
    </section>
  );
}

type Lookup = { booking: { id: string; code: string; status: string; total_paise: number; lot_name: string; plate: string; from: string }; refundable_paise: number };
function Refunds() {
  const [code, setCode] = useState(""), [found, setFound] = useState<Lookup | null>(null), [amount, setAmount] = useState(""), [reason, setReason] = useState("support"), [msg, setMsg] = useState("");
  async function find(e: React.FormEvent) {
    e.preventDefault(); setMsg(""); setFound(null);
    try { const r = await api<Lookup>(`/v1/admin/bookings/${encodeURIComponent(code.trim())}`); setFound(r); setAmount((r.refundable_paise / 100).toFixed(2)); }
    catch (x) { setMsg(errText(x, "Couldn't find that booking.")); }
  }
  async function refund() {
    if (!found) return;
    const paise = Math.round(Number(amount) * 100);
    if (!paise || paise > found.refundable_paise) return setMsg(`Enter up to ${rupees(found.refundable_paise)}.`);
    if (!confirm(`Refund ${rupees(paise)} on ${found.booking.code}?`)) return;
    try { await api("/v1/admin/refunds", { method: "POST", idempotent: true, body: { booking_id: found.booking.id, amount_paise: paise, reason } }); setMsg(`Refunded ${rupees(paise)}. It reaches the driver in 5–7 working days.`); setFound(null); }
    catch (x) { setMsg(errText(x, "Refund failed.")); }
  }
  return (
    <section className="panel card">
      <form className="formrow" onSubmit={find}>
        <div className="field"><label htmlFor="bc">Booking code</label><input id="bc" className="input mono" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BL-7Q2K" /></div>
        <button className="btn">Find</button>
      </form>
      {found && (
        <div className="card panel">
          <strong>{found.booking.code} · {found.booking.lot_name}</strong>
          <p className="muted" style={{ margin: 0 }}>{found.booking.plate} · {when(found.booking.from)} · {found.booking.status} · paid {rupees(found.booking.total_paise)} · refundable {rupees(found.refundable_paise)}</p>
          <div className="formrow">
            <div className="field"><label htmlFor="ra">Amount (₹)</label><input id="ra" className="input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div className="field"><label htmlFor="rr">Reason</label><select id="rr" className="input" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="support">Support goodwill</option><option value="lot_unavailable">Lot unavailable</option><option value="double_charge">Double charge</option><option value="dispute">Payment dispute</option></select></div>
            <button className="btn kerb" type="button" onClick={refund} disabled={found.refundable_paise === 0}>Refund</button>
          </div>
        </div>
      )}
      {msg && <p className="okmsg" role="status">{msg}</p>}
    </section>
  );
}

function Promos() {
  const [nonce, setNonce] = useState(0), [msg, setMsg] = useState(""), [f, setF] = useState({ code: "", pct: "20", max: "100", first: false, weekend: false, uses: "" });
  const rows = useList<Promo>("/v1/admin/promos", nonce);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try {
      await api("/v1/admin/promos", { method: "POST", body: { code: f.code.trim().toUpperCase(), percent_off: Number(f.pct), max_off_paise: Math.round(Number(f.max) * 100),
        first_booking_only: f.first, weekend_only: f.weekend, max_uses: f.uses ? Number(f.uses) : undefined } });
      setMsg("Promo created."); setNonce(n => n + 1);
    } catch (x) { setMsg(errText(x, "Couldn't create the promo.")); }
  }
  return (
    <section className="panel card">
      {!rows ? <div className="skel" /> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Code</th><th className="r">Off</th><th className="r">Cap</th><th>Rules</th><th className="r">Used</th><th>Status</th></tr></thead>
          <tbody>{rows.map(p => (
            <tr key={p.code}><td className="mono">{p.code}</td><td className="r">{p.percent_off}%</td><td className="r">{rupees(p.max_off_paise)}</td>
              <td>{[p.first_booking_only && "first booking", p.weekend_only && "weekends", p.max_uses && `max ${p.max_uses}`].filter(Boolean).join(" · ") || "—"}</td>
              <td className="r">{p.used_count}</td><td><span className={`pill ${p.active ? "ok" : ""}`}>{p.active ? "active" : "inactive"}</span></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <form className="card panel" onSubmit={add} noValidate>
        <strong>New promo (platform-funded: operators are paid on the full price)</strong>
        <div className="formrow">
          <div className="field"><label htmlFor="pc">Code</label><input id="pc" className="input mono" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="DIWALI30" /></div>
          <div className="field"><label htmlFor="pp">% off</label><input id="pp" className="input" inputMode="numeric" value={f.pct} onChange={e => setF({ ...f, pct: e.target.value })} /></div>
          <div className="field"><label htmlFor="pm">Max off (₹)</label><input id="pm" className="input" inputMode="decimal" value={f.max} onChange={e => setF({ ...f, max: e.target.value })} /></div>
          <div className="field"><label htmlFor="pu">Max uses</label><input id="pu" className="input" inputMode="numeric" value={f.uses} onChange={e => setF({ ...f, uses: e.target.value })} placeholder="unlimited" /></div>
        </div>
        <div className="row">
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.first} onChange={e => setF({ ...f, first: e.target.checked })} /> First booking only</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.weekend} onChange={e => setF({ ...f, weekend: e.target.checked })} /> Weekends only</label>
        </div>
        <button className="btn">Create promo</button>
        {msg && <p className="okmsg" role="status">{msg}</p>}
      </form>
    </section>
  );
}

function Audit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null), [next, setNext] = useState<number | null>(null), [entity, setEntity] = useState("");
  useEffect(() => {
    let live = true;
    api<{ entries: AuditEntry[]; next_before_id: number | null }>(`/v1/admin/audit?limit=50${entity ? `&entity=${entity}` : ""}`)
      .then(r => { if (live) { setEntries(r.entries); setNext(r.next_before_id); } }).catch(() => { if (live) setEntries([]); });
    return () => { live = false; };
  }, [entity]);
  async function more() {
    if (!next) return;
    const r = await api<{ entries: AuditEntry[]; next_before_id: number | null }>(`/v1/admin/audit?limit=50&before_id=${next}${entity ? `&entity=${entity}` : ""}`);
    setEntries(e => [...(e ?? []), ...r.entries]); setNext(r.next_before_id);
  }
  return (
    <section className="panel card">
      <div className="chips" role="group" aria-label="Filter">
        {[["", "All"], ["payout", "Payouts"], ["booking", "Refunds"], ["operator", "Operators"], ["lot", "Lots"], ["lot_rate", "Rates"], ["promo", "Promos"], ["monthly_pass", "Monthly"]].map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={entity === k} onClick={() => setEntity(k)}>{l}</button>)}
      </div>
      {!entries ? <div className="skel" /> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Change</th></tr></thead>
          <tbody>{entries.map(a => (
            <tr key={a.id}><td>{when(a.at)}</td><td className="mono" style={{ fontSize: 13 }}>{a.actor_phone ?? "system"}<div className="muted" style={{ fontSize: 12 }}>{a.actor_role}</div></td>
              <td>{a.action.replace(/_/g, " ")}</td><td>{a.entity}<div className="muted mono" style={{ fontSize: 11 }}>{a.entity_id?.slice(0, 13)}</div></td>
              <td className="mono" style={{ fontSize: 12, maxWidth: 360, wordBreak: "break-word" }}>{a.after ? JSON.stringify(a.after).slice(0, 160) : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {next && <button className="btn ghost" onClick={more}>Older entries</button>}
    </section>
  );
}
