"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { dayKey, formatDate, formatTime, zoneName } from "@/lib/format";

export interface FlowQuestion { id: string; label: string; kind: string; required: boolean }

interface Props {
  slug: string;
  event: string;
  bookingWindowDays: number;
  questions: FlowQuestion[];
}

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const noSubscribe = () => () => {};
const detectZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type Month = { y: number; m: number }; // m is 0-11
type Loaded = { key: string; slots: string[] | null }; // null slots = failed

function monthOf(date: Date, tz: string): Month {
  const [y, m] = dayKey(date, tz).split("-").map(Number);
  return { y, m: m - 1 };
}
const shift = ({ y, m }: Month, by: number): Month => ({ y: y + Math.floor((m + by) / 12), m: (((m + by) % 12) + 12) % 12 });
const monthLabel = ({ y, m }: Month) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m, 1));

export function BookingFlow({ slug, event, bookingWindowDays, questions }: Props) {
  const detected = useSyncExternalStore(noSubscribe, detectZone, () => null);
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const tz = chosenZone ?? detected;
  const [now] = useState(() => new Date());
  const [month, setMonth] = useState<Month | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const shown = month ?? (tz ? monthOf(now, tz) : null);
  const firstMonth = tz ? monthOf(now, tz) : null;
  const lastMonth = tz ? monthOf(new Date(now.getTime() + bookingWindowDays * DAY), tz) : null;
  const sy = shown?.y;
  const sm = shown?.m;
  const requestKey = shown ? `${sy}-${sm}-${attempt}` : null;

  useEffect(() => {
    if (sy === undefined || sm === undefined) return;
    const key = `${sy}-${sm}-${attempt}`;
    const from = new Date(Math.max(now.getTime(), Date.UTC(sy, sm, 1) - DAY));
    const to = new Date(Date.UTC(sy, sm + 1, 1) + DAY);
    const params = new URLSearchParams({ slug, event, from: from.toISOString(), to: to.toISOString() });
    let live = true;
    fetch(`/api/slots?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { slots: string[] }) => live && setLoaded({ key, slots: body.slots }))
      .catch(() => live && setLoaded({ key, slots: null }));
    return () => { live = false; };
  }, [sy, sm, attempt, slug, event, now]);

  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!tz || sm === undefined || loaded?.key !== requestKey || !loaded.slots) return map;
    const prefix = `${sy}-${String(sm + 1).padStart(2, "0")}`;
    for (const s of loaded.slots) {
      const k = dayKey(new Date(s), tz);
      if (k.startsWith(prefix)) map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [loaded, requestKey, tz, sy, sm]);

  if (!tz || !shown || !firstMonth || !lastMonth) return <Skeleton />;
  const loading = loaded?.key !== requestKey;
  const failed = !loading && loaded?.slots === null;
  const canPrev = shown.y * 12 + shown.m > firstMonth.y * 12 + firstMonth.m;
  const canNext = shown.y * 12 + shown.m < lastMonth.y * 12 + lastMonth.m;
  const goMonth = (by: number) => { setMonth(shift(shown, by)); setDay(null); };
  const zoneLabel = `Times shown in ${zoneName(tz)}${tz === detected ? " (your time)" : ""}`;

  if (slot) {
    return (
      <DetailsForm
        slug={slug} event={event} tz={tz} slot={slot} questions={questions}
        onPick={setSlot} onBack={() => setSlot(null)}
      />
    );
  }

  const daysInMonth = new Date(Date.UTC(shown.y, shown.m + 1, 0)).getUTCDate();
  const lead = new Date(Date.UTC(shown.y, shown.m, 1)).getUTCDay();
  const keyFor = (d: number) => `${shown.y}-${String(shown.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <section aria-label="Pick a date">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => goMonth(-1)} disabled={!canPrev} aria-label="Previous month">‹</Button>
          <h2 className="font-semibold text-text" aria-live="polite">{monthLabel(shown)}</h2>
          <Button variant="ghost" onClick={() => goMonth(1)} disabled={!canNext} aria-label="Next month">›</Button>
        </div>
        {loading ? <Skeleton /> : failed ? (
          <div className="mt-4 rounded-md bg-danger-bg p-4 text-danger" role="alert">
            <p>Couldn&apos;t load times. Try again.</p>
            <Button variant="secondary" className="mt-3" onClick={() => setAttempt((a) => a + 1)}>Retry</Button>
          </div>
        ) : byDay.size === 0 ? (
          <div className="mt-4 rounded-md bg-surface p-4">
            <p className="text-text">No open times this month</p>
            {canNext && <Button variant="secondary" className="mt-3" onClick={() => goMonth(1)}>Show next month</Button>}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-7 gap-1 text-center" role="grid">
            {WEEKDAYS.map((w) => <span key={w} className="text-xs text-text-muted" aria-hidden>{w}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const k = keyFor(i + 1);
              const open = byDay.has(k);
              return (
                <button
                  key={k} type="button" disabled={!open} onClick={() => setDay(k)} aria-pressed={day === k}
                  aria-label={`${formatDate(new Date(`${k}T12:00:00Z`), "UTC")}${open ? ", times available" : ", no times"}`}
                  className={`h-11 rounded-md text-sm ${focusRing} ${open ? "font-bold text-text hover:bg-surface" : "text-text-muted opacity-60"} ${day === k ? "bg-accent text-on-accent hover:bg-accent" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section aria-label="Pick a time">
        <p className="text-sm text-text-muted">{zoneLabel}</p>
        <Label htmlFor="tz" className="mt-2">Time zone</Label>
        <select
          id="tz" value={tz} onChange={(e) => setChosenZone(e.target.value)}
          className={`mt-1 h-11 w-full rounded-md border border-border-input bg-card px-3 text-text ${focusRing}`}
        >
          {Intl.supportedValuesOf("timeZone").concat(Intl.supportedValuesOf("timeZone").includes(tz) ? [] : [tz]).map((z) => (
            <option key={z} value={z}>{z.replaceAll("_", " ")}</option>
          ))}
        </select>
        {day && byDay.get(day) && (
          <>
            <h2 className="mt-4 font-semibold text-text">{formatDate(new Date(byDay.get(day)![0]), tz)}</h2>
            <ul className="mt-2 grid gap-2">
              {byDay.get(day)!.map((s) => (
                <li key={s}>
                  <Button variant="secondary" className="w-full" onClick={() => setSlot(s)} aria-label={`${formatDate(new Date(s), tz)}, ${formatTime(new Date(s), tz)} ${zoneName(tz)}`}>
                    {formatTime(new Date(s), tz)}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 grid grid-cols-7 gap-1" aria-busy="true" aria-label="Loading times">
      {Array.from({ length: 35 }, (_, i) => <span key={i} className="h-11 animate-pulse rounded-md bg-surface motion-reduce:animate-none" />)}
    </div>
  );
}

interface FormProps {
  slug: string; event: string; tz: string; slot: string; questions: FlowQuestion[];
  onPick: (slot: string) => void; onBack: () => void;
}

function DetailsForm({ slug, event, tz, slot, questions, onPick, onBack }: FormProps) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [taken, setTaken] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const start = new Date(slot);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const answers = Object.fromEntries(questions.map((q) => [q.id, String(data.get(`q_${q.id}`) ?? "")]));
    setBusy(true); setFailed(false);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, event, start: slot, name: data.get("name"), email: data.get("email"), phone: data.get("phone") || undefined, timezone: tz, answers, idempotencyKey }),
      });
      const body = await res.json();
      if (res.status === 201 || res.status === 200) {
        router.push(`/${slug}/${event}/booked/${body.bookingId}`);
        return;
      }
      if (res.status === 409) { setTaken(body.nextSlots ?? []); setErrors({}); }
      else if (res.status === 400) setErrors(body.fields ?? {});
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 grid max-w-md gap-4">
      <div>
        <p className="font-semibold text-text">{formatDate(start, tz)}, {formatTime(start, tz)} {zoneName(tz)}</p>
        <button type="button" onClick={onBack} className={`min-h-11 text-sm font-semibold text-accent underline ${focusRing}`}>Pick another time</button>
      </div>
      {taken && (
        <div className="rounded-md bg-danger-bg p-4" role="alert">
          <p className="text-danger">That time was just taken. Here are the next open times:</p>
          <ul className="mt-2 grid gap-2">
            {taken.map((s) => (
              <li key={s}>
                <Button variant="secondary" className="w-full" onClick={() => { setTaken(null); onPick(s); }}>
                  {formatDate(new Date(s), tz)}, {formatTime(new Date(s), tz)} {zoneName(tz)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div><Label htmlFor="name">Your name</Label><Input id="name" name="name" autoComplete="name" required maxLength={100} error={errors.name} /></div>
      <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required error={errors.email} /></div>
      <div><Label htmlFor="phone">WhatsApp number (optional)</Label><Input id="phone" name="phone" type="tel" autoComplete="tel" error={errors.phone} /></div>
      {questions.map((q) => {
        const id = `q_${q.id}`;
        const err = errors[`answers.${q.id}`];
        return (
          <div key={q.id}>
            <Label htmlFor={id}>{q.label}{q.required ? "" : " (optional)"}</Label>
            {q.kind === "long_text" ? (
              <>
                <textarea
                  id={id} name={id} rows={4} required={q.required} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-error` : undefined}
                  className={`mt-1 block w-full rounded-md border bg-card p-3 text-base text-text ${err ? "border-danger" : "border-border-input"} ${focusRing}`}
                />
                {err && <p id={`${id}-error`} className="mt-1 text-sm text-danger">{err}</p>}
              </>
            ) : (
              <Input id={id} name={id} required={q.required} error={err} />
            )}
          </div>
        );
      })}
      {failed && <p className="text-danger" role="alert">Something went wrong. Your time isn&apos;t booked yet. Try again.</p>}
      <Button type="submit" loading={busy}>{busy ? "Booking…" : "Book this time"}</Button>
    </form>
  );
}
