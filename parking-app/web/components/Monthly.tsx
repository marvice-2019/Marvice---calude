"use client";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { cleanPlate, km, PLATE } from "@/lib/format";
import { nextQuarter, rangeQuery } from "@/lib/time";
import type { SearchRow } from "@/lib/types";
import { SignIn } from "./SignIn";
import { useMe } from "./useMe";

const AREAS = [{ name: "MG Road", lat: 12.9756, lng: 77.6066 }, { name: "Koramangala", lat: 12.9352, lng: 77.6245 }, { name: "Indiranagar", lat: 12.9784, lng: 77.6408 }, { name: "Whitefield", lat: 12.9698, lng: 77.75 }];

function firstOfNextMonth() {
  const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export function Monthly() {
  const { me, reload } = useMe();
  const [area, setArea] = useState(AREAS[0]), [lots, setLots] = useState<SearchRow[] | null>(null);
  const [lotId, setLotId] = useState(""), [plate, setPlate] = useState(""), [start, setStart] = useState(firstOfNextMonth());
  const [err, setErr] = useState(""), [done, setDone] = useState(""), [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams(rangeQuery(nextQuarter(), 8, "car"));
    q.set("lat", String(area.lat)); q.set("lng", String(area.lng));
    api<SearchRow[]>(`/v1/lots/search?${q}`).then(r => { if (live) setLots(r); }).catch(() => { if (live) setLots([]); });
    return () => { live = false; };
  }, [area]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!lotId) return setErr("Pick a lot.");
    setBusy(true);
    try {
      let vehicleId = me?.vehicles[0]?.id;
      const p = cleanPlate(plate || me?.vehicles[0]?.plate || "");
      if (!vehicleId || (plate && p !== me?.vehicles[0]?.plate)) {
        if (!PLATE.test(p)) { setBusy(false); return setErr("Enter the number plate like KA01AB1234."); }
        vehicleId = (await api<{ vehicle: { id: string } }>("/v1/me/vehicles", { method: "POST", body: { plate: p, kind: "car" } })).vehicle.id;
      }
      const r = await api<{ message: string }>("/v1/monthly-passes", { method: "POST", body: { lot_id: lotId, vehicle_id: vehicleId, starts_on: start } });
      setDone(r.message);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't send the request. Try again."); }
    setBusy(false);
  }

  if (me === null) return <SignIn title="Sign in to request a monthly bay" onDone={reload} />;
  if (done) return <div className="empty card"><h3>Request sent</h3><p>{done} We&apos;ll text you a payment link when it&apos;s approved.</p></div>;

  return (
    <form className="card panel" onSubmit={submit} noValidate>
      <div className="field">
        <span className="label" id="area-l">Area</span>
        <div className="chips" role="group" aria-labelledby="area-l">
          {AREAS.map(a => <button key={a.name} type="button" className="chip" aria-pressed={area.name === a.name} onClick={() => { setArea(a); setLots(null); setLotId(""); }}>{a.name}</button>)}
        </div>
      </div>
      <fieldset className="pay" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Lot</legend>
        {lots === null && <div className="skel" style={{ height: 60 }} />}
        {lots?.length === 0 && <p className="muted">No lots with monthly bays here yet.</p>}
        {lots?.map(r => (
          <label key={r.lot.id}><input type="radio" name="lot" value={r.lot.id} checked={lotId === r.lot.id} onChange={() => setLotId(r.lot.id)} />
            <span><strong>{r.lot.name}</strong> <span className="muted">· {km(r.distance_m)}{r.lot.covered ? " · covered" : ""}</span></span></label>
        ))}
      </fieldset>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="m-plate">Number plate</label>
          <input id="m-plate" className="input mono" value={plate || me?.vehicles[0]?.plate || ""} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="KA01AB1234" maxLength={13} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="m-start">Start</label>
          <input id="m-start" type="date" className="input" value={start} min={new Date().toISOString().slice(0, 10)} onChange={e => setStart(e.target.value)} /></div>
      </div>
      <p className="err" role="alert">{err}</p>
      <button className="btn block" disabled={busy || me === undefined}>{busy ? "Sending…" : "Request a monthly bay"}</button>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing is charged now. The monthly price with GST is on the approval message.</p>
    </form>
  );
}
