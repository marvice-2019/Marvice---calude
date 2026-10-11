"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import type { SearchRow } from "@/lib/contract";
import { defaultWindow, km } from "@/lib/format";
import { areaBySlug } from "@/lib/places";
import { local } from "@/lib/session";
import { track } from "@/lib/track";

const HOURS = [1, 2, 3, 4, 8];

/** S03 Park now (DRV-09): lot code from the entrance board, or one of the 3 nearest lots, then hours. */
export function ParkNow({ areaSlug }: { areaSlug?: string }) {
  const router = useRouter();
  const [area, setArea] = useState(() => areaBySlug(areaSlug));
  const [code, setCode] = useState("");
  const [hours, setHours] = useState(2);
  const [near, setNear] = useState<SearchRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!areaSlug) setArea(areaBySlug(local<string>("area"))); }, [areaSlug]);
  useEffect(() => {
    const w = defaultWindow();
    api.search({ lat: area.lat, lng: area.lng, from: w.from.toISOString(), to: w.to.toISOString(), vehicle: "car" })
      .then(r => setNear(r.slice(0, 3))).catch(() => setNear([]));
  }, [area]);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    const c = code.replace(/[\s-]/g, "").toUpperCase();
    track("park_now_code_entered", { method: "typed", valid: !!c });
    if (!c) { setErr("Enter the lot code, or pick a lot below."); return; }
    setBusy(true); setErr("");
    try {
      const { lot } = await api.lotByCode(c);
      router.push(`/lot/${lot.id}?now=1&hours=${hours}&vehicle=car`);
    } catch (e2) {
      setErr(e2 instanceof ApiFailure && e2.status === 404
        ? `No lot with code ${c}. Check the board at the entrance, or pick a lot below.`
        : e2 instanceof ApiFailure ? e2.message : "Couldn't check that code. Try again.");
      setBusy(false);
    }
  }

  return (
    <section className="panelpage">
      <span className="tag" style={{ color: "var(--sign)", display: "inline-block" }}>Park now</span>
      <h1>Pay at the lot</h1>
      <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>The lot code is on the yellow board at the entrance.</p>
      <form className="stack" onSubmit={go} noValidate aria-label="Park now">
        <div className="field"><label htmlFor="pn-code">Lot code</label>
          <input id="pn-code" className="mono" autoComplete="off" placeholder="BLR101" style={{ textTransform: "uppercase" }} value={code} onChange={e => setCode(e.target.value)} /></div>
        <div className="sec-h" style={{ margin: 0 }}>Or pick a lot near {area.name}</div>
        <div className="near">
          {near === null ? <div className="skel" style={{ height: 48 }} aria-hidden="true" /> :
            near.length === 0 ? <span style={{ color: "var(--muted)" }}>No lots within 3 km of {area.name}.</span> :
            near.map(r => (
              <button key={r.lot.id} type="button" aria-pressed={code === r.lot.code} onClick={() => { setCode(r.lot.code); track("park_now_code_entered", { method: "picked", valid: true }); }}>
                <span><span className="lotcode">{r.lot.code}</span> {r.lot.name}</span><span className="num" style={{ color: "var(--muted)" }}>{km(r.distance_m)}</span>
              </button>))}
        </div>
        <div className="sec-h" style={{ margin: 0 }} id="dur-l">How long?</div>
        <div className="durs" role="group" aria-labelledby="dur-l">
          {HOURS.map(h => <button key={h} type="button" aria-pressed={h === hours} onClick={() => setHours(h)}>{h} h</button>)}
        </div>
        <div className="err" role="alert">{err}</div>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Checking code…" : "Continue to pay"}</button>
      </form>
    </section>
  );
}
