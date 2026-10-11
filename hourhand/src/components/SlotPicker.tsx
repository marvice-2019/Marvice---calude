"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { dayKey, formatDate, formatTime, zoneName } from "@/lib/format";
import { setTimeFormat, useTimeFormat } from "./useTimeFormat";
import { intlTag, t, type Locale } from "@/lib/i18n/guest";

interface PickerProps {
  slug: string;
  event: string;
  bookingWindowDays: number;
  /** When rescheduling: the booking's manage token, so its own time doesn't hide slots. */
  manageToken?: string;
  /** Booking through a single-use link: times come from the link's event type. */
  linkToken?: string;
  /** Open on this time's day (an ISO instant), e.g. from a "book again" email suggestion. */
  initialAt?: string;
  /** The guest's language. */
  locale?: Locale;
  /** Called with the chosen slot (ISO instant) and the zone the guest was viewing times in. */
  onPick: (slot: string, tz: string) => void;
}

const DAY = 86_400_000;
const noSubscribe = () => () => {};
const detectZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The device's zone; null on the server and the first client render. */
export const useDeviceZone = () => useSyncExternalStore(noSubscribe, detectZone, () => null);

type Month = { y: number; m: number }; // m is 0-11
type Loaded = { key: string; slots: string[] | null }; // null slots = failed

function monthOf(date: Date, tz: string): Month {
  const [y, m] = dayKey(date, tz).split("-").map(Number);
  return { y, m: m - 1 };
}
const shift = ({ y, m }: Month, by: number): Month => ({ y: y + Math.floor((m + by) / 12), m: (((m + by) % 12) + 12) % 12 });
const monthLabel = ({ y, m }: Month, locale: Locale) => new Intl.DateTimeFormat(intlTag(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m, 1));
/** Sunday-first short weekday names; 4 Jan 1970 was a Sunday. */
const weekdays = (locale: Locale) => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(intlTag(locale), { weekday: "short", timeZone: "UTC" }).format(Date.UTC(1970, 0, 4 + i)));

/** Month calendar plus the open times of the chosen day, in a zone the guest can change. */
export function SlotPicker({ slug, event, bookingWindowDays, manageToken, linkToken, initialAt, locale = "en", onPick }: PickerProps) {
  const detected = useDeviceZone();
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const tz = chosenZone ?? detected;
  const cycle = useTimeFormat();
  const [now] = useState(() => new Date());
  const [month, setMonth] = useState<Month | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Until the guest picks a month or day themselves, a suggested time opens its own month and day.
  const initial = initialAt && !Number.isNaN(Date.parse(initialAt)) && Date.parse(initialAt) > now.getTime() ? new Date(initialAt) : null;
  const day = picked ?? (month === null && initial && tz ? dayKey(initial, tz) : null);

  const shown = month ?? (tz ? monthOf(initial ?? now, tz) : null);
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
    // A single-use link names its own host and event type; the slug pair is only for the public page.
    const params = linkToken
      ? new URLSearchParams({ link: linkToken, from: from.toISOString(), to: to.toISOString() })
      : new URLSearchParams({ slug, event, from: from.toISOString(), to: to.toISOString() });
    if (manageToken) params.set("token", manageToken);
    let live = true;
    fetch(`/api/slots?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { slots: string[] }) => live && setLoaded({ key, slots: body.slots }))
      .catch(() => live && setLoaded({ key, slots: null }));
    return () => { live = false; };
  }, [sy, sm, attempt, slug, event, manageToken, linkToken, now]);

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

  if (!tz || !shown || !firstMonth || !lastMonth) return <Skeleton label={t(locale, "loadingTimes")} />;
  const loading = loaded?.key !== requestKey;
  const failed = !loading && loaded?.slots === null;
  const canPrev = shown.y * 12 + shown.m > firstMonth.y * 12 + firstMonth.m;
  const canNext = shown.y * 12 + shown.m < lastMonth.y * 12 + lastMonth.m;
  const goMonth = (by: number) => { setMonth(shift(shown, by)); setPicked(null); };
  const zoneLabel = t(locale, tz === detected ? "timesShownInYours" : "timesShownIn", { zone: zoneName(tz) });

  const daysInMonth = new Date(Date.UTC(shown.y, shown.m + 1, 0)).getUTCDate();
  const lead = new Date(Date.UTC(shown.y, shown.m, 1)).getUTCDay();
  const keyFor = (d: number) => `${shown.y}-${String(shown.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <section aria-label={t(locale, "pickDate")}>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => goMonth(-1)} disabled={!canPrev} aria-label={t(locale, "prevMonth")}>‹</Button>
          <h2 className="font-semibold text-text" aria-live="polite">{monthLabel(shown, locale)}</h2>
          <Button variant="ghost" onClick={() => goMonth(1)} disabled={!canNext} aria-label={t(locale, "nextMonth")}>›</Button>
        </div>
        {loading ? <Skeleton label={t(locale, "loadingTimes")} /> : failed ? (
          <div className="mt-4 rounded-md bg-danger-bg p-4 text-danger" role="alert">
            <p>{t(locale, "loadFailed")}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setAttempt((a) => a + 1)}>{t(locale, "retry")}</Button>
          </div>
        ) : byDay.size === 0 ? (
          <div className="mt-4 rounded-md bg-surface p-4">
            <p className="text-text">{t(locale, "noTimesMonth")}</p>
            {canNext && <Button variant="secondary" className="mt-3" onClick={() => goMonth(1)}>{t(locale, "showNextMonth")}</Button>}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-7 gap-1 text-center" role="grid">
            {weekdays(locale).map((w) => <span key={w} className="text-xs text-text-muted" aria-hidden>{w}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const k = keyFor(i + 1);
              const open = byDay.has(k);
              return (
                <button
                  key={k} type="button" disabled={!open} onClick={() => setPicked(k)} aria-pressed={day === k}
                  aria-label={t(locale, open ? "dayOpen" : "dayClosed", { date: formatDate(new Date(`${k}T12:00:00Z`), "UTC", locale) })}
                  className={`h-11 rounded-md text-sm ${focusRing} ${open ? "font-bold text-text hover:bg-surface" : "text-text-muted opacity-60"} ${day === k ? "bg-accent text-on-accent hover:bg-accent" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section aria-label={t(locale, "pickTime")}>
        <div role="radiogroup" aria-label={t(locale, "timeFormat")} className="mb-3 flex gap-2">
          {(["12h", "24h"] as const).map((c) => (
            <Button
              key={c} role="radio" aria-checked={cycle === c} variant={cycle === c ? "primary" : "secondary"}
              onClick={() => setTimeFormat(c)}
            >
              {c}
            </Button>
          ))}
        </div>
        <p className="text-sm text-text-muted">{zoneLabel}</p>
        <Label htmlFor="tz" className="mt-2">{t(locale, "timeZone")}</Label>
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
            <h2 className="mt-4 font-semibold text-text">{formatDate(new Date(byDay.get(day)![0]), tz, locale)}</h2>
            <ul className="mt-2 grid gap-2">
              {byDay.get(day)!.map((s) => (
                <li key={s}>
                  <Button variant="secondary" className="w-full" onClick={() => onPick(s, tz)} aria-label={`${formatDate(new Date(s), tz, locale)}, ${formatTime(new Date(s), tz, cycle, locale)} ${zoneName(tz)}`}>
                    {formatTime(new Date(s), tz, cycle, locale)}
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

function Skeleton({ label }: { label: string }) {
  return (
    <div className="mt-4 grid grid-cols-7 gap-1" aria-busy="true" aria-label={label}>
      {Array.from({ length: 35 }, (_, i) => <span key={i} className="h-11 animate-pulse rounded-md bg-surface motion-reduce:animate-none" />)}
    </div>
  );
}

