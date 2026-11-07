"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookingSummary, formatTime, last4, pickUtm, validateBookingForm, whatsappLink, type FieldErrors } from "@/booking/form";
import { FLOOR, hitBox, MOBILE_RENDER_WIDTH, VIEWBOX, type FloorTable, type ZoneKey } from "@/content/floor-plan";
import { on } from "@/lib/site-events";
import { track } from "@/lib/track";

export type PlannerZone = { key: ZoneKey; name: string; colour: string; note: string | null };
export type PlannerProps = {
  dates: string[];
  initialDate?: string;
  initialTable?: string;
  zones: PlannerZone[];
  maxGuests: number;
  whatsapp: string;
  instagram: string;
};

type Slot = { time: string; available: number };
type TableState = "available" | "booked" | "held";
type Confirmed = { ref: string; date: string; time: string; table: string; guests: number; name: string; last4: string };
type ApiError = { ok: false; code: string; message: string; fields?: FieldErrors; alternatives?: { code: string; zone: string }[] };

const ZOOMS = [{ label: "Fit", width: null }, { label: "Zoom", width: MOBILE_RENDER_WIDTH }, { label: "Close", width: MOBILE_RENDER_WIDTH * 1.5 }] as const;

function dateLabel(date: string, i: number): string {
  if (i === 0) return "Tonight";
  if (i === 1) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function BookingPlanner({ dates, initialDate, initialTable, zones, maxGuests, whatsapp, instagram }: PlannerProps) {
  const [date, setDate] = useState(initialDate && dates.includes(initialDate) ? initialDate : dates[0]!);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, TableState>>({});
  const [zoneFilter, setZoneFilter] = useState<ZoneKey | "all">("all");
  const [table, setTable] = useState<string | null>(initialTable ?? null);
  const [zoom, setZoom] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", guests: 2, notes: "", consent: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ message: string; alternatives: { code: string; zone: string }[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Confirmed | null>(null);
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const [barVisible, setBarVisible] = useState(false);

  const zoneByKey = useMemo(() => new Map(zones.map((z) => [z.key, z])), [zones]);
  const selected = table ? FLOOR.tables.find((t) => t.code === table) ?? null : null;

  // Phones start zoomed in so every table is a 44 px target; desktops fit the whole plan.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setZoom(1);
  }, []);

  // Campaign parameters from the landing URL, kept for the session and sent with the booking.
  useEffect(() => {
    try {
      const utm = pickUtm(window.location.search);
      if (utm) sessionStorage.setItem("hydra:utm", JSON.stringify(utm));
    } catch {
      /* storage blocked: booking still works without UTM */
    }
  }, []);

  // Other sections: Nights cards pre-fill a date, VIP cards filter a zone.
  useEffect(() => {
    const offDate = on("hydra:pick-date", ({ date: d }) => {
      if (dates.includes(d)) setDate(d);
    });
    const offZone = on("hydra:pick-zone", ({ zone }) => setZoneFilter(zone));
    return () => {
      offDate();
      offZone();
    };
  }, [dates]);

  // Time slots for the chosen night.
  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    fetch(`/api/availability?date=${date}`)
      .then((r) => r.json())
      .then((res: { ok: boolean; slots?: Slot[] }) => {
        if (cancelled) return;
        const list = res.ok && res.slots ? res.slots : [];
        setSlots(list);
        setTime((prev) => {
          if (prev && list.some((s) => s.time === prev && s.available > 0)) return prev;
          const evening = list.find((s) => s.time >= "20:00" && s.available > 0);
          return (evening ?? list.find((s) => s.available > 0))?.time ?? null;
        });
      })
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const loadStates = useCallback(async (d: string, t: string) => {
    const res = (await fetch(`/api/availability?date=${d}&time=${t}`).then((r) => r.json())) as {
      ok: boolean;
      tables?: { code: string; state: TableState }[];
    };
    const next = Object.fromEntries((res.tables ?? []).map((x) => [x.code, x.state]));
    setStates(next);
    return next;
  }, []);

  // Table states for the chosen night and time; drop a selection that just became unavailable.
  useEffect(() => {
    if (!time) {
      setStates({});
      return;
    }
    let cancelled = false;
    loadStates(date, time).then((next) => {
      if (cancelled) return;
      setTable((cur) => {
        if (cur && next[cur] && next[cur] !== "available") {
          setAnnounce(`${cur} is no longer free at ${formatTime(time)}. Pick another table.`);
          return null;
        }
        return cur;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [date, time, loadStates]);

  // Smart bottom bar: hidden while the hero, the floor plan or the form is on screen.
  useEffect(() => {
    const ids = ["top", "floor", "book"];
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        setBarVisible(visible.size === 0);
      },
      { threshold: 0.05 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  function pick(t: FloorTable) {
    const state = states[t.code] ?? "available";
    if (state !== "available" || !time) return;
    setTable(t.code);
    setBanner(null);
    setErrors((e) => ({ ...e, table: undefined }));
    const zone = zoneByKey.get(t.zone)?.name ?? t.zone;
    setAnnounce(`${t.code} selected, ${zone}, free at ${formatTime(time)}.`);
    navigator.vibrate?.(10);
    track("table_pick", { table: t.code, zone: t.zone });
    const frame = frameRef.current;
    const svg = frame?.querySelector("svg");
    if (frame && svg && svg.clientWidth > frame.clientWidth) {
      const scale = svg.clientWidth / VIEWBOX.w;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      frame.scrollTo({
        left: (t.x + t.w / 2) * scale - frame.clientWidth / 2,
        top: (t.y + t.h / 2) * scale - frame.clientHeight / 2,
        behavior: reduce ? "auto" : "smooth",
      });
    }
  }

  const tableMax = Math.max(1, maxGuests);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const found = validateBookingForm(form, { maxGuests: tableMax, table, time });
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length) {
      focusFirstError(found);
      return;
    }
    setSubmitting(true);
    let utm: Record<string, string> | undefined;
    try {
      utm = JSON.parse(sessionStorage.getItem("hydra:utm") ?? "null") ?? undefined;
    } catch {
      utm = undefined;
    }
    track("booking_submit", { table: table!, date });
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table, date, time, ...form, website: honeypotRef.current?.value ?? "", utm }),
      });
      const body = (await res.json()) as { ok: true; booking: Omit<Confirmed, "last4"> } | ApiError;
      if (body.ok) {
        setDone({ ...body.booking, last4: last4(form.phone) });
        setAnnounce(`Booked. Your reference is ${body.booking.ref}.`);
        requestAnimationFrame(() => document.getElementById("booking-confirmation")?.focus());
        return;
      }
      if (body.code === "table_taken") {
        setTable(null);
        setBanner({ message: body.message, alternatives: body.alternatives ?? [] });
        setAnnounce(body.message);
        if (time) await loadStates(date, time);
        return;
      }
      if (body.fields) {
        setErrors(body.fields);
        focusFirstError(body.fields);
      }
      setBanner({ message: body.message, alternatives: [] });
    } catch {
      setBanner({ message: "We couldn't reach the booking system. Check your connection and try again.", alternatives: [] });
    } finally {
      setSubmitting(false);
    }
  }

  function focusFirstError(e: FieldErrors) {
    const order = ["table", "time", "guests", "name", "phone", "notes", "consent"] as const;
    const first = order.find((k) => e[k]);
    if (!first) return;
    const el = first === "table" ? document.getElementById("floor") : formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`);
    el?.focus?.();
    if (first === "table") el?.scrollIntoView({ block: "start" });
  }

  async function copyDetails() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(bookingSummary(done));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const svgWidth = ZOOMS[zoom]!.width;
  const free = slots?.find((s) => s.time === time)?.available;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <p className="sr-only" aria-live="polite" role="status">
        {announce}
      </p>

      {/* Planner */}
      <div className="min-w-0 space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm text-muted">Night</legend>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {dates.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === date}
                onClick={() => setDate(d)}
                className="min-h-11 shrink-0 rounded-full border border-line px-4 text-sm whitespace-nowrap aria-pressed:border-neon aria-pressed:bg-neon aria-pressed:text-on-aqua aria-pressed:font-semibold"
              >
                {dateLabel(d, i)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm text-muted">
            Time {errors.time && <span className="text-[#ff8a8a]">· {errors.time}</span>}
          </legend>
          {slots === null ? (
            <p className="h-11 text-sm text-muted">Checking times…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted">No times left for this night. Pick another night.</p>
          ) : (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  name="time"
                  disabled={s.available === 0}
                  aria-pressed={s.time === time}
                  aria-label={`${formatTime(s.time)}, ${s.available} tables free`}
                  onClick={() => setTime(s.time)}
                  className="flex min-h-11 shrink-0 flex-col items-center justify-center rounded-xl border border-line px-3 text-sm leading-tight disabled:opacity-35 aria-pressed:border-neon aria-pressed:bg-neon aria-pressed:text-on-aqua"
                >
                  <span className="font-semibold">{formatTime(s.time)}</span>
                  <span className="text-[11px] opacity-80">{s.available} free</span>
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by zone">
          {(["all", ...zones.map((z) => z.key)] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={zoneFilter === k}
              onClick={() => setZoneFilter(k)}
              className="min-h-11 rounded-full border border-line px-4 text-sm aria-pressed:border-text aria-pressed:bg-surface2"
            >
              {k === "all" ? "All zones" : zoneByKey.get(k)?.name}
            </button>
          ))}
          <div className="ml-auto flex gap-1" role="group" aria-label="Zoom">
            {ZOOMS.map((z, i) => (
              <button
                key={z.label}
                type="button"
                aria-pressed={zoom === i}
                onClick={() => setZoom(i)}
                className="min-h-11 min-w-11 rounded-lg border border-line px-3 text-sm aria-pressed:bg-surface2 aria-pressed:border-text"
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={frameRef} className="relative max-h-[70vh] overflow-auto rounded-2xl border border-line bg-surface" tabIndex={-1}>
          <svg
            viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
            style={svgWidth ? { width: svgWidth, height: "auto" } : undefined}
            className={svgWidth ? "block max-w-none" : "block h-auto w-full"}
            aria-labelledby="floor-title"
          >
            <title id="floor-title">Hydra floor plan. Pick a free table.</title>
            <defs>
              <pattern id="taken-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="12" height="12" fill="#1a2532" />
                <line x1="0" y1="0" x2="0" y2="12" stroke="#2c3a4a" strokeWidth="5" />
              </pattern>
            </defs>
            {FLOOR.background && <image href={FLOOR.background} width={VIEWBOX.w} height={VIEWBOX.h} opacity={0.35} />}
            <rect {...FLOOR.room} rx={28} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={3} />
            {FLOOR.features.map((f) => (
              <g key={f.label} aria-hidden="true">
                <rect
                  x={f.x}
                  y={f.y}
                  width={f.w}
                  height={f.h}
                  rx={f.kind === "dance" ? 24 : 14}
                  fill={f.kind === "dance" ? "rgba(43,184,220,.06)" : "rgba(255,255,255,.04)"}
                  stroke={f.kind === "dance" ? "rgba(43,184,220,.35)" : "rgba(255,255,255,.12)"}
                  strokeDasharray={f.kind === "mezz" ? "10 8" : undefined}
                  strokeWidth={2}
                />
                <text
                  x={f.x + f.w / 2}
                  y={f.kind === "mezz" ? f.y + 34 : f.y + f.h / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#8DA2B5"
                  fontSize={f.kind === "bar" ? 24 : 28}
                  transform={f.kind === "bar" ? `rotate(-90 ${f.x + f.w / 2} ${f.y + f.h / 2})` : undefined}
                >
                  {f.label}
                </text>
              </g>
            ))}
            {FLOOR.markers.map((m) => (
              <g key={m.n} aria-hidden="true">
                <circle cx={m.x} cy={m.y} r={18} fill="#E3B26A" opacity={0.85} />
                <text x={m.x} y={m.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={700} fill="#03070D">
                  {m.n}
                </text>
              </g>
            ))}
            {FLOOR.tables.map((t) => {
              const state = time ? states[t.code] ?? "available" : "available";
              const isSel = t.code === table;
              const usable = !!time && state === "available";
              const dim = zoneFilter !== "all" && zoneFilter !== t.zone;
              const zone = zoneByKey.get(t.zone);
              const colour = zone?.colour ?? "#2BB8DC";
              const hit = hitBox(t);
              const stateText = !time ? "pick a time first" : state === "available" ? "free" : state === "held" ? "reserved that night" : "booked at this time";
              return (
                <g
                  key={t.code}
                  data-id={t.code}
                  data-state={isSel ? "selected" : state}
                  role="button"
                  tabIndex={usable ? 0 : -1}
                  aria-disabled={!usable}
                  aria-pressed={isSel}
                  aria-label={`Table ${t.code}, ${zone?.name ?? t.zone}, ${stateText}`}
                  onClick={() => pick(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(t);
                    }
                  }}
                  className={`outline-none transition-opacity focus-visible:[&>.ring]:opacity-100 ${usable ? "cursor-pointer" : "cursor-not-allowed"}`}
                  opacity={dim ? 0.28 : 1}
                >
                  <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} fill="transparent" />
                  <rect
                    className="ring opacity-0"
                    x={t.x - 8}
                    y={t.y - 8}
                    width={t.w + 16}
                    height={t.h + 16}
                    rx={t.round ? (t.h + 16) / 2 : 16}
                    fill="none"
                    stroke="#EAF2F8"
                    strokeWidth={4}
                  />
                  <rect
                    x={t.x}
                    y={t.y}
                    width={t.w}
                    height={t.h}
                    rx={t.round ? t.h / 2 : 12}
                    fill={isSel ? colour : state === "available" ? `${colour}26` : "url(#taken-hatch)"}
                    stroke={state === "available" || isSel ? colour : "#2c3a4a"}
                    strokeWidth={isSel ? 5 : 3}
                    style={isSel ? { filter: `drop-shadow(0 0 14px ${colour})` } : undefined}
                  />
                  <text
                    x={t.x + t.w / 2}
                    y={t.y + t.h / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={t.code.length > 4 ? 22 : 26}
                    fontWeight={700}
                    fill={isSel ? "#021015" : state === "available" ? "#EAF2F8" : "#5d6b7a"}
                  >
                    {t.code}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
          <li>
            <span className="mr-1.5 inline-block size-3 rounded-sm border-2 border-aqua align-middle" /> Free
          </li>
          <li>
            <span className="mr-1.5 inline-block size-3 rounded-sm bg-aqua align-middle" /> Your pick
          </li>
          <li>
            <span className="mr-1.5 inline-block size-3 rounded-sm bg-[#2c3a4a] align-middle" /> Booked or reserved
          </li>
          <li>
            <span className="mr-1.5 inline-block size-3 rounded-full bg-amber align-middle" /> Numbered markers aren&apos;t tables
          </li>
        </ul>
      </div>

      {/* Side panel: selected table, form, confirmation */}
      <div id="book" className="scroll-mt-24 rounded-2xl border border-line bg-surface/80 p-5 backdrop-blur lg:sticky lg:top-24">
        {done ? (
          <div id="booking-confirmation" tabIndex={-1} className="space-y-4 outline-none">
            <p className="text-sm text-muted">Request received</p>
            <p className="font-display text-5xl tracking-[-0.05em] text-neon">{done.ref}</p>
            <p>{bookingSummary(done)}</p>
            <p className="text-sm text-muted">
              Your table is held while the team confirms it. Keep the reference: you&apos;ll need it with the last 4 digits of your phone to change or cancel.
            </p>
            <div className="grid gap-2">
              {whatsappLink(whatsapp, `Hi Hydra, ${bookingSummary(done)}`) && (
                <a
                  href={whatsappLink(whatsapp, `Hi Hydra, ${bookingSummary(done)}`)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("whatsapp_click", { from: "confirmation" })}
                  className="flex min-h-11 items-center justify-center rounded-xl bg-neon px-4 font-semibold text-on-aqua"
                >
                  Message us on WhatsApp
                </a>
              )}
              <button type="button" onClick={copyDetails} className="min-h-11 rounded-xl border border-line px-4">
                {copied ? "Copied" : "Copy details"}
              </button>
              <a
                href={`/api/bookings/${done.ref}/ics?last4=${done.last4}`}
                className="flex min-h-11 items-center justify-center rounded-xl border border-line px-4"
              >
                Add to calendar
              </a>
              <button
                type="button"
                onClick={() => {
                  setDone(null);
                  setTable(null);
                  if (time) void loadStates(date, time);
                }}
                className="min-h-11 rounded-xl px-4 text-sm text-muted underline underline-offset-4"
              >
                Book another table
              </button>
            </div>
            <p className="sr-only" aria-live="polite">
              {copied ? "Booking details copied." : ""}
            </p>
          </div>
        ) : (
          <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
            <div>
              <p className="text-sm text-muted">Your table</p>
              {selected ? (
                <p className="font-display text-3xl tracking-[-0.05em]">
                  {selected.code}{" "}
                  <span className="font-sans text-base font-normal text-muted">
                    · {zoneByKey.get(selected.zone)?.name}
                    {time && ` · ${formatTime(time)}`}
                  </span>
                </p>
              ) : (
                <p className={errors.table ? "text-[#ff8a8a]" : "text-muted"}>
                  {errors.table ?? "Tap a free table on the plan."}
                </p>
              )}
              {selected && zoneByKey.get(selected.zone)?.note && <p className="mt-1 text-sm text-muted">{zoneByKey.get(selected.zone)!.note}</p>}
              {time && typeof free === "number" && <p className="mt-1 text-xs text-muted">{free} tables free at {formatTime(time)}</p>}
            </div>

            {banner && (
              <div role="alert" className="rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm">
                <p>{banner.message}</p>
                {banner.alternatives.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {banner.alternatives.map((a) => (
                      <button
                        key={a.code}
                        type="button"
                        onClick={() => {
                          const t = FLOOR.tables.find((x) => x.code === a.code);
                          if (t) pick(t);
                        }}
                        className="min-h-11 rounded-full border border-neon px-4 font-semibold"
                      >
                        {a.code}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Field label="Guests" error={errors.guests} id="guests">
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Fewer guests" onClick={() => setForm((f) => ({ ...f, guests: Math.max(1, f.guests - 1) }))} className="size-11 rounded-xl border border-line text-xl">
                  −
                </button>
                <input
                  id="guests"
                  name="guests"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={tableMax}
                  value={form.guests}
                  onChange={(e) => setForm((f) => ({ ...f, guests: Number(e.target.value) }))}
                  aria-invalid={!!errors.guests}
                  aria-describedby={errors.guests ? "guests-err" : undefined}
                  className="h-11 w-20 rounded-xl border border-line bg-surface2 text-center text-lg"
                />
                <button type="button" aria-label="More guests" onClick={() => setForm((f) => ({ ...f, guests: Math.min(tableMax, f.guests + 1) }))} className="size-11 rounded-xl border border-line text-xl">
                  +
                </button>
              </div>
            </Field>
            <Field label="Name" error={errors.name} id="name">
              <input
                id="name"
                name="name"
                autoComplete="name"
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "name-err" : undefined}
                className="h-11 w-full rounded-xl border border-line bg-surface2 px-3"
              />
            </Field>
            <Field label="Mobile number" hint="10-digit Indian mobile" error={errors.phone} id="phone">
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "phone-err" : "phone-hint"}
                className="h-11 w-full rounded-xl border border-line bg-surface2 px-3"
              />
            </Field>
            <Field label="Notes (optional)" error={errors.notes} id="notes">
              <textarea
                id="notes"
                name="notes"
                rows={2}
                maxLength={500}
                placeholder="Birthday, high chair, arriving late…"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-xl border border-line bg-surface2 px-3 py-2"
              />
            </Field>
            {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Website
                <input ref={honeypotRef} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            <div>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  name="consent"
                  type="checkbox"
                  checked={form.consent}
                  onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))}
                  aria-invalid={!!errors.consent}
                  aria-describedby={errors.consent ? "consent-err" : undefined}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--neon)]"
                />
                <span>Hydra can contact me on this number about this booking (WhatsApp or call).</span>
              </label>
              {errors.consent && (
                <p id="consent-err" className="mt-1 text-sm text-[#ff8a8a]">
                  {errors.consent}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-12 w-full rounded-xl bg-neon px-4 text-lg font-semibold text-on-aqua disabled:opacity-60"
            >
              {submitting ? "Booking…" : selected && time ? `Book ${selected.code} · ${formatTime(time)}` : "Book a table"}
            </button>
            <p className="text-xs text-muted">
              Questions?{" "}
              <a href={instagram} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                Message us on Instagram
              </a>
              .
            </p>
          </form>
        )}
      </div>

      {/* Smart bottom bar (phones): only while the hero, plan and form are all off screen */}
      {!done && (
        <div
          className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 p-3 backdrop-blur transition-transform lg:hidden ${barVisible ? "translate-y-0" : "pointer-events-none translate-y-full"}`}
          aria-hidden={!barVisible}
        >
          <a
            href={selected ? "#book" : "#floor"}
            tabIndex={barVisible ? 0 : -1}
            className="flex min-h-12 items-center justify-center rounded-xl bg-neon font-semibold text-on-aqua"
          >
            {selected ? `Book ${selected.code}` : "Pick your table"}
          </a>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, error, id, children }: { label: string; hint?: string; error?: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="ml-1 text-xs">
            · {hint}
          </span>
        )}
      </label>
      {children}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm text-[#ff8a8a]">
          {error}
        </p>
      )}
    </div>
  );
}
