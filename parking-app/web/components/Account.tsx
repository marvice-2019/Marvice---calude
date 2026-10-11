"use client";
import { useState } from "react";
import { api, ApiFailure, authCall } from "@/lib/api";
import { cleanPlate, PLATE } from "@/lib/format";
import { greeting } from "@/lib/format";
import { SignIn } from "./SignIn";
import { useMe } from "./useMe";

export function Account() {
  const { me, reload } = useMe();
  const [plate, setPlate] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");

  if (me === undefined) return <div className="skel" style={{ height: 300 }} />;
  if (me === null) return <SignIn onDone={reload} />;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(""); setMsg("");
    try { await fn(); setMsg(ok); await reload(); } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Something went wrong. Try again."); }
  };
  const addVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    const p = cleanPlate(plate);
    if (!PLATE.test(p)) return setErr("Enter the number plate like KA01AB1234.");
    run(() => api("/v1/me/vehicles", { method: "POST", body: { plate: p, kind: "car" } }), `${p} added.`).then(() => setPlate(""));
  };
  const pref = (body: Record<string, unknown>) => run(() => api("/v1/me/preferences", { method: "PUT", body }), "Saved.");

  return (
    <div className="panel" style={{ padding: 0, gap: 18 }}>
      <section className="card panel">
        <span className="label">{greeting()}</span>
        <p className="big num" style={{ margin: 0 }}>{me.user.full_name ?? me.user.phone.replace("+91", "+91 ")}</p>
        <p className="muted" style={{ margin: 0 }}>Signed in with {me.user.phone}</p>
      </section>

      <section className="card panel" aria-labelledby="veh-h">
        <h2 id="veh-h" style={{ fontSize: 24 }}>Vehicles</h2>
        {me.vehicles.length === 0 && <p className="muted" style={{ margin: 0 }}>No vehicles yet. Add one and checkout fills it in for you.</p>}
        {me.vehicles.map(v => (
          <div key={v.id} className="list-row"><span className="mono">{v.plate}</span>
            <label className="row" style={{ gap: 6 }}><input type="radio" name="defv" checked={me.preferences.vehicle_id === v.id} onChange={() => pref({ default_vehicle_id: v.id })} /> Default</label></div>
        ))}
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={addVehicle}>
          <label htmlFor="add-plate" className="sr">Number plate</label>
          <input id="add-plate" className="input mono" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="KA01AB1234" maxLength={13} />
          <button className="btn ghost">Add</button>
        </form>
      </section>

      <section className="card panel" aria-labelledby="pref-h">
        <h2 id="pref-h" style={{ fontSize: 24 }}>Preferences</h2>
        <div className="list-row"><span>Usual payment</span>
          <div className="seg" role="group" aria-label="Usual payment">
            {(["upi", "card", "netbanking"] as const).map(m => <button key={m} type="button" aria-pressed={me.preferences.payment_method === m} onClick={() => pref({ payment_method: m })}>{m === "upi" ? "UPI" : m === "card" ? "Card" : "Bank"}</button>)}
          </div></div>
        <div className="list-row"><span>Reminders on WhatsApp</span>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={me.preferences.alerts} onChange={e => pref({ alerts: e.target.checked })} /> {me.preferences.alerts ? "On" : "Off"}</label></div>
        <div className="list-row"><span>Language</span>
          <div className="seg" role="group" aria-label="Language">
            {([["en", "English"], ["kn", "ಕನ್ನಡ"], ["hi", "हिन्दी"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={me.preferences.language === k} onClick={() => pref({ language: k })}>{l}</button>)}
          </div></div>
      </section>

      <section className="card panel" aria-labelledby="data-h">
        <h2 id="data-h" style={{ fontSize: 24 }}>Your data</h2>
        <div className="list-row"><span>Download a copy of your data</span><button className="btn ghost" onClick={() => run(() => api("/v1/me/data-export", { method: "POST" }), "Export requested. We'll send a link to your phone.")}>Request</button></div>
        <div className="list-row"><span>Delete account</span><button className="btn ghost" onClick={() => {
          if (confirm("Delete your account? Passes stop working. Tax invoices are kept as the law requires.")) run(async () => { await api("/v1/me", { method: "DELETE" }); await authCall("logout"); }, "Account deleted.");
        }}>Delete</button></div>
        <div className="list-row"><span>Sign out of this device</span><button className="btn ghost" onClick={() => run(() => authCall("logout"), "Signed out.")}>Sign out</button></div>
      </section>
      <p className="okmsg" role="status">{msg}</p>
      <p className="err" role="alert">{err}</p>
    </div>
  );
}
