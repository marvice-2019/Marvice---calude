"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LotMap } from "@/components/LotMap";
import { useSession } from "@/components/hooks";
import { api, ApiFailure } from "@/lib/api";
import type { SearchRow, VehicleKind } from "@/lib/contract";
import { fromLocalInput, inr, KIND_LABEL, km, toLocalInput } from "@/lib/format";
import { AREAS, areaBySlug } from "@/lib/places";
import { local } from "@/lib/session";
import { track } from "@/lib/track";

type Sort = "dist" | "price" | "left";
export type FindParams = { area: string; from: string; to: string; vehicle: VehicleKind; sort: Sort };

function validate(from: Date | null, to: Date | null): string {
  if (!from || !to) return "Enter both arrival and leaving times.";
  if (to <= from) return "Leaving time must be after arrival. Move it later.";
  if (to.getTime() - from.getTime() > 30 * 86_400_000) return "Bookings run up to 30 days. For longer stays, use Monthly.";
  return "";
}

/** S01 Find: search strip, Park now strip, results list and schematic map (DRV-01, DRV-08). */
export function FindView({ initial }: { initial: FindParams }) {
  const router = useRouter();
  const session = useSession();
  const [p, setP] = useState(initial);
  const [arrive, setArrive] = useState(toLocalInput(new Date(initial.from)));
  const [leave, setLeave] = useState(toLocalInput(new Date(initial.to)));
  const [formErr, setFormErr] = useState("");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [err, setErr] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const area = areaBySlug(p.area);

  useEffect(() => { if (session) api.me().then(m => setFavs(new Set(m.favourites))).catch(() => {}); }, [session]);

  // Keep the URL shareable and remember the area for Park now and Monthly.
  useEffect(() => {
    const q = "?" + new URLSearchParams({ area: p.area, from: p.from, to: p.to, vehicle: p.vehicle, sort: p.sort }).toString();
    if (window.location.search !== q) router.replace("/" + q, { scroll: false }); // each replace re-renders the server page
    local("area", p.area);
  }, [p, router]);

  useEffect(() => {
    const ctl = new AbortController();
    setRows(null); setErr("");
    api.search({ lat: area.lat, lng: area.lng, from: p.from, to: p.to, vehicle: p.vehicle, sort: p.sort }, ctl.signal)
      .then(r => { setRows(r); track("search_performed", { area: p.area, from: p.from, to: p.to, vehicle: p.vehicle, results_count: r.length }); })
      .catch(e => { if ((e as Error).name !== "AbortError") setErr(e instanceof ApiFailure ? e.message : "Couldn't load lots. Try again."); });
    return () => ctl.abort();
  }, [p, area.lat, area.lng, attempt]);

  const onTimes = useCallback((a: string, l: string) => {
    setArrive(a); setLeave(l);
    const from = fromLocalInput(a), to = fromLocalInput(l), m = validate(from, to);
    setFormErr(m);
    if (!m && from && to) setP(x => ({ ...x, from: from.toISOString(), to: to.toISOString() }));
  }, []);

  const shown = useMemo(() => (rows ?? []).filter(r => !favOnly || favs.has(r.lot.id)), [rows, favOnly, favs]);
  const hours = rows?.[0]?.quote.hours ?? Math.max(1, Math.ceil((+new Date(p.to) - +new Date(p.from)) / 3_600_000));
  const lotHref = (r: SearchRow) => `/lot/${r.lot.id}?` + new URLSearchParams({ from: p.from, to: p.to, vehicle: p.vehicle }).toString();

  return (
    <section>
      <form className="search" onSubmit={e => e.preventDefault()} noValidate aria-label="Search parking">
        <div className="field f-area"><label htmlFor="area">Where are you going?</label>
          <select id="area" value={p.area} onChange={e => setP(x => ({ ...x, area: e.target.value }))}>
            {AREAS.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="arrive">Arrive</label>
          <input type="datetime-local" id="arrive" value={arrive} onChange={e => onTimes(e.target.value, leave)} /></div>
        <div className="field"><label htmlFor="leave">Leave</label>
          <input type="datetime-local" id="leave" value={leave} onChange={e => onTimes(arrive, e.target.value)} /></div>
        <div className="field"><span className="label" id="vlab" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)", fontWeight: 700 }}>Vehicle</span>
          <div className="seg" role="group" aria-labelledby="vlab">
            {(["car", "bike"] as const).map(v => (
              <button key={v} type="button" aria-pressed={p.vehicle === v} onClick={() => setP(x => ({ ...x, vehicle: v }))}>{v === "car" ? "Car" : "Bike"}</button>
            ))}
          </div></div>
      </form>
      <div className="err" role="alert">{formErr}</div>

      <div className="park-now">
        <div><b>Already at the gate?</b><span>Type the lot code from the signboard and pay for the hours you need. No booking needed.</span></div>
        <Link className="btn" href={`/park-now?area=${p.area}`}>Park now</Link>
      </div>

      <div className="results-head">
        <h1>{p.vehicle === "bike" ? "Bike" : "Car"} parking near {area.name} · {hours} h</h1>
        <div className="sort">
          <label className="favtoggle"><input type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} /> Saved lots only</label>
          <label htmlFor="sort">Sort by</label>
          <select id="sort" value={p.sort} onChange={e => setP(x => ({ ...x, sort: e.target.value as Sort }))}>
            <option value="dist">Nearest</option><option value="price">Lowest price</option><option value="left">Most spots left</option>
          </select>
        </div>
      </div>

      <div className="find-grid">
        <div className="list" aria-live="polite" aria-busy={rows === null && !err}>
          {err ? (
            <div className="errbox" role="alert"><span>{err}</span>
              <button className="btn ghost" type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
          ) : rows === null ? (
            <>{[0, 1, 2].map(i => <div key={i} className="skel" aria-hidden="true" />)}<span className="sr-only">Loading lots…</span></>
          ) : shown.length === 0 ? (
            <div className="empty">{favOnly
              ? (session ? "No saved lots yet. Open a lot and tap Save to keep it here for next time." : <>Sign in to see saved lots. <Link href="/signin?next=/">Sign in</Link></>)
              : "No lots match. Try a later time or another area."}</div>
          ) : shown.map(r => (
            <Link key={r.lot.id} className="lot" href={lotHref(r)} onClick={() => track("lot_viewed", { lot_id: r.lot.id, distance_m: r.distance_m, price: r.quote.totalPaise })}>
              <span className="p-sign" aria-hidden="true">P</span>
              <span style={{ minWidth: 0 }}>
                <h2>{r.lot.name}</h2>
                <div className="meta"><span className="lotcode">{r.lot.code}</span> {km(r.distance_m)} · {KIND_LABEL[r.lot.kind] ?? r.lot.kind}</div>
                <div className="chips">
                  {favs.has(r.lot.id) && <span className="chip fav">★ Saved</span>}
                  {r.lot.covered && <span className="chip">Covered</span>}
                  {r.lot.ev_chargers > 0 && <span className="chip ev">EV charging</span>}
                  {r.lot.open_24h && <span className="chip">Open 24 hours</span>}
                  {r.lot.status && r.lot.status !== "open" && <span className="chip">{r.lot.status === "full" ? "Full right now" : "Gate down"}</span>}
                </div>
                <div className={`left ${r.spots_left < 10 ? "low" : ""}`}>{r.spots_left === 0 ? "Full for these times" : r.spots_left < 10 ? `Only ${r.spots_left} spots left` : `${r.spots_left} spots left`}</div>
              </span>
              <span className="price"><b className="num">{inr(r.quote.totalPaise)}</b><span>total incl. GST</span><br /><span className="num">{inr(r.quote.ratePaise)}/hr</span></span>
            </Link>
          ))}
        </div>
        <LotMap center={area} label={area.name} rows={shown} hrefFor={lotHref} />
      </div>
    </section>
  );
}
