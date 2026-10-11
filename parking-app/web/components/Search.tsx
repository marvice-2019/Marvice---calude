"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import type { Destination, FilterId, SearchRow, VehicleKind } from "@/lib/types";
import { ARRIVALS, DURATIONS, fromLocalInput, rangeQuery, toLocalInput } from "@/lib/time";
import { when } from "@/lib/format";
import { LotCard } from "./LotCard";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "covered", label: "Covered" }, { id: "ev", label: "EV charging" }, { id: "valet", label: "Valet" },
  { id: "h24", label: "Open 24 h" }, { id: "bike", label: "Bike bays" }, { id: "saved", label: "Saved" }
];
const VEHICLES: { id: VehicleKind; label: string }[] = [{ id: "car", label: "Car" }, { id: "suv", label: "SUV" }, { id: "ev_car", label: "EV" }, { id: "bike", label: "Bike" }];
const DEFAULT_DEST: Destination = { name: "MG Road", kind: "area", lat: 12.9756, lng: 77.6066 };
const RECENT_KEY = "bl_recent_dest";

function loadRecent(): Destination[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}

export function Search({ initial = DEFAULT_DEST }: { initial?: Destination }) {
  const [dest, setDest] = useState<Destination>(initial);
  const [text, setText] = useState(initial.name);
  const [sugg, setSugg] = useState<{ q: string; list: Destination[] }>({ q: "", list: [] });
  const [recent, setRecent] = useState<Destination[]>([]);
  const [open, setOpen] = useState(false), [hi, setHi] = useState(0);
  const [arrival, setArrival] = useState("now"), [custom, setCustom] = useState("");
  const [hours, setHours] = useState(2), [vehicle, setVehicle] = useState<VehicleKind>("car");
  const [filters, setFilters] = useState<FilterId[]>([]), [sort, setSort] = useState<"dist" | "price" | "left">("dist");
  const [res, setRes] = useState<{ key: string; rows: SearchRow[] | null; err: string } | null>(null), [nonce, setNonce] = useState(0);
  const listId = useId();

  const from = useMemo(() => (arrival === "custom" && custom ? fromLocalInput(custom) : (ARRIVALS.find(a => a.id === arrival) ?? ARRIVALS[0]).at()),
    [arrival, custom]); // "now" is re-read whenever the preset changes
  const query = rangeQuery(from, hours, vehicle);

  // Typed text asks the API; an empty box shows recent places (read on focus, an event, not during render).
  const typed = text.trim() && text.trim() !== dest.name ? text.trim() : "";
  useEffect(() => {
    if (!open || !typed) return;
    let live = true;
    const t = setTimeout(() => api<Destination[]>(`/v1/destinations?q=${encodeURIComponent(typed)}`)
      .then(list => { if (live) setSugg({ q: typed, list }); }).catch(() => undefined), 160);
    return () => { live = false; clearTimeout(t); };
  }, [typed, open]);
  const shown = typed ? (sugg.q === typed ? sugg.list : []) : recent;

  const params = useMemo(() => {
    const p = new URLSearchParams(query);
    p.set("lat", String(dest.lat)); p.set("lng", String(dest.lng)); p.set("sort", sort);
    if (filters.length) p.set("filters", filters.join(","));
    return p.toString();
  }, [query, dest, sort, filters]);
  const key = `${params}#${nonce}`;
  useEffect(() => {
    let live = true;
    api<SearchRow[]>(`/v1/lots/search?${params}`)
      .then(rows => { if (live) setRes({ key, rows, err: "" }); })
      .catch(x => { if (live) setRes({ key, rows: null, err: x instanceof ApiFailure ? x.message : "Couldn't load lots. Try again." }); });
    return () => { live = false; };
  }, [params, key]);
  const loading = res?.key !== key;
  const rows = res?.rows ?? null, err = loading ? "" : res?.err ?? "";
  const run = () => setNonce(n => n + 1);

  function choose(d: Destination) {
    setDest(d); setText(d.name); setOpen(false);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([d, ...loadRecent().filter(x => x.name !== d.name)].slice(0, 5))); } catch { /* private mode */ }
  }
  function onKey(e: React.KeyboardEvent) {
    if (!open || !shown.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => (h + 1) % shown.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => (h - 1 + shown.length) % shown.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(shown[hi]); }
    else if (e.key === "Escape") setOpen(false);
  }
  const toggle = (f: FilterId) => setFilters(fs => (fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f]));

  return (
    <>
      <section className="search-card card" aria-label="Find parking">
        <div className="dest">
          <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-4.3-4.3" /></svg>
          <label htmlFor="dest" className="sr">Where are you going?</label>
          <input id="dest" role="combobox" aria-expanded={open && shown.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={open && shown[hi] ? `${listId}-${hi}` : undefined} autoComplete="off"
            placeholder="Where are you going? Area, mall, stadium…" value={text}
            onChange={e => { setText(e.target.value); setOpen(true); setHi(0); }} onFocus={() => { setOpen(true); setRecent(loadRecent()); }}
            onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} />
          {text && <button type="button" className="btn ghost" style={{ minHeight: 40, padding: "6px 12px" }} onClick={() => { setText(""); setOpen(true); }} aria-label="Clear destination">✕</button>}
        </div>
        {open && shown.length > 0 && (
          <ul className="suggest card" id={listId} role="listbox">
            {shown.map((s, i) => (
              <li key={s.name} role="option" id={`${listId}-${i}`} aria-selected={i === hi}>
                <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => choose(s)}>
                  <span>{s.name}</span><span className="muted">{s.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="field">
          <span className="label" id="arr-l">Arriving</span>
          <div className="chips" role="group" aria-labelledby="arr-l">
            {ARRIVALS.map(a => <button key={a.id} type="button" className="chip" aria-pressed={arrival === a.id} onClick={() => setArrival(a.id)}>{a.label}</button>)}
            <button type="button" className="chip" aria-pressed={arrival === "custom"} onClick={() => { setArrival("custom"); setCustom(c => c || toLocalInput(from)); }}>Pick a time</button>
          </div>
          {arrival === "custom" && (
            <input aria-label="Arrival date and time" type="datetime-local" className="input" value={custom} min={toLocalInput(new Date())} onChange={e => setCustom(e.target.value)} />
          )}
        </div>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="field">
            <span className="label" id="dur-l">For</span>
            <div className="chips" role="group" aria-labelledby="dur-l">
              {DURATIONS.map(h => <button key={h} type="button" className="chip soft" aria-pressed={hours === h} onClick={() => setHours(h)}>{h === 24 ? "All day" : `${h} h`}</button>)}
            </div>
          </div>
          <div className="field">
            <span className="label" id="veh-l">Vehicle</span>
            <div className="seg" role="group" aria-labelledby="veh-l">
              {VEHICLES.map(v => <button key={v.id} type="button" aria-pressed={vehicle === v.id} onClick={() => setVehicle(v.id)}>{v.label}</button>)}
            </div>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{when(from)} → {when(new Date(from.getTime() + hours * 3_600_000))}</p>
      </section>

      <section className="wrap" aria-labelledby="results-h">
        <div className="section-head">
          <h2 id="results-h">Near {dest.name}</h2>
          <div className="seg" role="group" aria-label="Sort">
            {([["dist", "Nearest"], ["price", "Cheapest"], ["left", "Most bays"]] as const).map(([k, l]) =>
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
          </div>
        </div>
        <div className="chips" role="group" aria-label="Filters" style={{ marginBottom: 14 }}>
          {FILTERS.map(f => <button key={f.id} type="button" className="chip" aria-pressed={filters.includes(f.id)} onClick={() => toggle(f.id)}>{f.label}</button>)}
        </div>

        <div className="grid2">
          <div aria-live="polite" aria-busy={loading}>
            {loading && <div className="lots">{[0, 1, 2].map(i => <div key={i} className="skel" />)}</div>}
            {err && (
              <div className="empty card">
                <h3>{err.includes("Sign in") ? "Sign in to see saved lots" : "Couldn't load lots"}</h3><p>{err}</p>
                {err.includes("Sign in") ? <Link className="btn" href="/account">Sign in</Link> : <button className="btn" onClick={run}>Try again</button>}
              </div>
            )}
            {!loading && rows && rows.length === 0 && (
              <div className="empty card">
                <EmptyArt />
                <h3>No bays here for those times</h3>
                <p>Try a shorter stay, drop a filter, or search a nearby area.</p>
                {filters.length > 0 && <button className="btn ghost" onClick={() => setFilters([])}>Clear filters</button>}
              </div>
            )}
            {!loading && rows && rows.length > 0 && <ul className="lots">{rows.map((r, i) => <LotCard key={r.lot.id} row={r} query={query} i={i} />)}</ul>}
          </div>
          <aside className="stick" aria-label="Park now">
            <div className="parknow card">
              <span className="p" aria-hidden>P</span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong>Already at the gate?</strong>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: 14 }}>Type the number on the entrance board and pay in under a minute.</p>
              </div>
              <Link className="btn kerb" href="/park-now">Park now</Link>
            </div>
            <div className="card panel" style={{ marginTop: 14 }}>
              <strong>What you see is what you pay</strong>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>Every price includes the ₹15 platform fee and 18% GST. Cancel free up to an hour before arrival. You get a GST invoice with every booking.</p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

function EmptyArt() {
  return (
    <svg viewBox="0 0 120 80" aria-hidden>
      <rect x="8" y="50" width="104" height="6" rx="3" fill="var(--line)" />
      <rect x="22" y="22" width="28" height="28" rx="6" fill="var(--sign)" /><text x="36" y="43" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--on-sign)">P</text>
      <path d="M62 50V30h30l10 20" fill="none" stroke="var(--muted)" strokeWidth="3" strokeDasharray="5 5" />
    </svg>
  );
}
