"use client";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { PHONE } from "@/lib/format";

export function OwnerLead() {
  const [f, setF] = useState({ name: "", phone: "", address: "", bays: "" });
  const [err, setErr] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (f.name.trim().length < 2) return setErr("Enter your name.");
    if (!PHONE.test(f.phone)) return setErr("Enter a 10-digit Indian mobile number.");
    if (f.address.trim().length < 5) return setErr("Enter the property address.");
    const bays = Number(f.bays);
    if (!Number.isInteger(bays) || bays < 1) return setErr("How many bays? Enter a number.");
    setBusy(true);
    try { await api("/v1/leads/owners", { method: "POST", body: { name: f.name.trim(), phone: f.phone, address: f.address.trim(), bays } }); setDone(true); }
    catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't send. Try again."); }
    setBusy(false);
  }

  if (done) return <div className="empty card"><h3>Thanks, {f.name.split(" ")[0]}</h3><p>Our partner team calls you within one working day to visit the site.</p></div>;
  return (
    <form className="card panel" onSubmit={submit} noValidate aria-label="Tell us about your space">
      <h2 style={{ fontSize: 26 }}>Tell us about your space</h2>
      <div className="field"><label htmlFor="o-name">Your name</label><input id="o-name" className="input" autoComplete="name" value={f.name} onChange={set("name")} /></div>
      <div className="field"><label htmlFor="o-phone">Mobile number</label><input id="o-phone" className="input mono" inputMode="numeric" maxLength={10} autoComplete="tel-national" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} /></div>
      <div className="field"><label htmlFor="o-addr">Property address</label><input id="o-addr" className="input" autoComplete="street-address" value={f.address} onChange={set("address")} /></div>
      <div className="field"><label htmlFor="o-bays">Car bays available</label><input id="o-bays" className="input" inputMode="numeric" value={f.bays} onChange={e => setF({ ...f, bays: e.target.value.replace(/\D/g, "") })} /></div>
      <p className="err" role="alert">{err}</p>
      <button className="btn kerb block" disabled={busy}>{busy ? "Sending…" : "Get a call back"}</button>
    </form>
  );
}
