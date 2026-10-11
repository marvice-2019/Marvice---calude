"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMounted, useSession } from "@/components/hooks";
import { api, ApiFailure } from "@/lib/api";
import type { Me, PayMethod } from "@/lib/contract";
import { normPlate, PLATE_ERR, PLATE_RE } from "@/lib/format";
import { clearSession } from "@/lib/session";

/** S07 Account: phone, vehicles, payment preference, saved lots, sign out, delete account (DPDP). */
export function AccountView() {
  const mounted = useMounted();
  const session = useSession();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [plate, setPlate] = useState("");

  const load = useCallback(() => { api.me().then(setMe).catch(e => setErr(e instanceof ApiFailure ? e.message : "Couldn't load your account.")); }, []);
  useEffect(() => { if (session) load(); }, [session, load]);

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const p = normPlate(plate);
    if (!PLATE_RE.test(p)) { setErr(PLATE_ERR); return; }
    try { await api.addVehicle(p, "car"); setPlate(""); setMsg("Vehicle added."); load(); }
    catch (e2) { setErr(e2 instanceof ApiFailure ? e2.message : "Couldn't add the vehicle."); }
  }
  async function pref(b: { default_vehicle_id?: string; payment_method?: PayMethod }) {
    try { await api.setPreferences(b); setMsg("Saved."); load(); } catch (e) { setErr(e instanceof ApiFailure ? e.message : "Couldn't save."); }
  }
  async function del() {
    if (!window.confirm("Delete your account? Your passes and saved details go. Tax invoices are kept as the law requires.")) return;
    try { const r = await api.deleteAccount() as { message?: string }; clearSession(); alert(r.message ?? "Your account is deleted."); router.push("/"); }
    catch (e) { setErr(e instanceof ApiFailure ? e.message : "Couldn't delete the account. Try again."); }
  }

  if (!mounted) return <div className="skel" aria-hidden="true" />;
  if (!session) return (
    <section className="panelpage"><h1>Account</h1><p>Sign in with your mobile number to manage vehicles and saved lots.</p>
      <Link className="btn" href="/signin?next=/account">Sign in</Link></section>
  );
  return (
    <section className="panelpage">
      <h1>Account</h1>
      <div className="ok" role="status">{msg}</div><div className="err" role="alert">{err}</div>
      <dl className="kv"><dt>Mobile</dt><dd className="num">{session.user.phone}</dd></dl>
      {!me ? <div className="skel" aria-hidden="true" /> : (
        <>
          <div className="sec-h">Vehicles</div>
          {me.vehicles.length === 0 ? <p style={{ color: "var(--muted)" }}>No vehicles yet. They&apos;re added when you book.</p> : (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="sr-only">Default vehicle</legend>
              <div className="pay">{me.vehicles.map(v => (
                <label key={v.id}><input type="radio" name="dv" checked={me.preferences.vehicle_id === v.id} onChange={() => pref({ default_vehicle_id: v.id })} />
                  <span className="mono">{v.plate}</span> <span style={{ color: "var(--muted)" }}>{v.kind === "bike" ? "Two-wheeler" : "Car"}</span></label>))}</div>
            </fieldset>)}
          <form className="promo" onSubmit={addVehicle} style={{ marginTop: 10 }} noValidate>
            <label htmlFor="add-plate" className="sr-only">Add a vehicle number</label>
            <input id="add-plate" placeholder="KA 01 AB 1234" value={plate} onChange={e => setPlate(e.target.value)} />
            <button type="submit">Add</button>
          </form>
          <div className="sec-h">Pay with by default</div>
          <div className="field"><label htmlFor="pm" className="sr-only">Default payment method</label>
            <select id="pm" value={me.preferences.payment_method ?? "upi"} onChange={e => pref({ payment_method: e.target.value as PayMethod })}>
              <option value="upi">UPI</option><option value="card">Debit or credit card</option><option value="netbanking">Netbanking</option></select></div>
          <div className="sec-h">Saved lots</div>
          <p style={{ color: "var(--muted)", margin: 0 }}>{me.favourites.length ? `${me.favourites.length} saved. Use "Saved lots only" on Find to see them.` : "No saved lots yet. Open a lot and tap Save."}</p>
          <div className="stack">
            <button className="btn ghost" type="button" onClick={() => { clearSession(); router.push("/"); }}>Sign out</button>
            <button className="btn link" type="button" onClick={del} style={{ color: "var(--warn)" }}>Delete my account</button>
          </div>
        </>
      )}
    </section>
  );
}
