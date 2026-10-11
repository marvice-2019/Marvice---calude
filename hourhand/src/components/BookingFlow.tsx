"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { formatDate, formatTime, zoneName } from "@/lib/format";
import { t, tNodes, type GuestKey, type Locale } from "@/lib/i18n/guest";
import { zoneCheck } from "@/lib/tz-confirm";
import { LocalTime } from "./LocalTime";
import { payWithRazorpay, type CheckoutPayment } from "./razorpay-checkout";
import { SlotPicker, useDeviceZone } from "./SlotPicker";
import { useTimeFormat } from "./useTimeFormat";
import { WaitlistForm } from "./WaitlistForm";

export interface FlowQuestion { id: string; label: string; kind: string; required: boolean }

interface Props {
  slug: string;
  event: string;
  bookingWindowDays: number;
  questions: FlowQuestion[];
  /** For a priced event: the price as shown ("₹499") and the names Checkout shows the guest. */
  paid?: { price: string; hostName: string; eventName: string; deposit?: boolean } | null;
  /** Booking through a single-use link: times and the booking go through the link, which is used up by the booking. */
  linkToken?: string;
  /** Open the picker on this suggested time's day. */
  initialAt?: string;
  /** Whose page this is, so the form can show the time on their clock too. */
  host: { name: string; timezone: string };
  /** The most weeks the guest can book this time for in one go; 1 = no repeat choice. */
  maxWeeks?: number;
  /** Booking with a session package (the buyer's token): no payment, one session used per booking. */
  packageToken?: string;
  /** The guest's language, and "?lang=xx" when they chose it (carried to the next page). */
  locale?: Locale;
  langQuery?: string;
  /** Offer the waitlist (needs Postgres; not for single-use links or packages). */
  waitlist?: boolean;
}

/** Public booking: pick a time, then fill in details. The picker stays mounted so "Pick another time" keeps the month and day. */
export function BookingFlow({ slug, event, bookingWindowDays, questions, paid = null, linkToken, initialAt, host, maxWeeks = 1, packageToken, waitlist = false, locale = "en", langQuery = "" }: Props) {
  const [picked, setPicked] = useState<{ slot: string; tz: string } | null>(null);
  return (
    <>
      <div hidden={picked !== null}>
        <SlotPicker slug={slug} event={event} linkToken={linkToken} initialAt={initialAt} bookingWindowDays={bookingWindowDays} locale={locale} onPick={(slot, tz) => setPicked({ slot, tz })} />
        {waitlist && <WaitlistForm slug={slug} event={event} hostName={host.name} locale={locale} />}
      </div>
      {picked && (
        <DetailsForm
          slug={slug} event={event} linkToken={linkToken} tz={picked.tz} slot={picked.slot} questions={questions} paid={packageToken ? null : paid} host={host} maxWeeks={maxWeeks} packageToken={packageToken} locale={locale} langQuery={langQuery}
          onPick={(slot) => setPicked({ slot, tz: picked.tz })} onBack={() => setPicked(null)}
        />
      )}
    </>
  );
}

interface FormProps {
  slug: string; event: string; linkToken?: string; tz: string; slot: string; questions: FlowQuestion[]; paid: Props["paid"]; host: Props["host"]; maxWeeks: number; packageToken?: string; locale: Locale; langQuery: string;
  onPick: (slot: string) => void; onBack: () => void;
}

function DetailsForm({ slug, event, linkToken, tz, slot, questions, paid, host, maxWeeks, packageToken, locale, langQuery, onPick, onBack }: FormProps) {
  const router = useRouter();
  // A new key starts a fresh attempt; it changes only after an attempt is over (payment couldn't start, or the hold ran out).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const freshAttempt = () => setIdempotencyKey(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [taken, setTaken] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [limited, setLimited] = useState(false);
  const [linkGone, setLinkGone] = useState<string | null>(null);
  // Paid events: the order the server made, kept so a guest who closes Checkout can reopen it while the hold lasts.
  const [held, setHeld] = useState<{ bookingId: string; manageToken: string; payment: CheckoutPayment & { holdExpiresAt: string }; prefill: { name: string; email: string; contact?: string } } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  const [notPaid, setNotPaid] = useState(false);
  const [expired, setExpired] = useState(false);

  // Once the hold runs out the Pay button goes: paying after that would only be refunded.
  useEffect(() => {
    if (!held) return;
    const left = new Date(held.payment.holdExpiresAt).getTime() - Date.now();
    const t = setTimeout(() => { setHeld(null); setExpired(true); freshAttempt(); }, Math.max(0, left));
    return () => clearTimeout(t);
  }, [held]);

  /** Opens Checkout; after a payment the server checks it with Razorpay. The booked page shows the result either way. */
  async function pay(h: NonNullable<typeof held>) {
    setCheckoutFailed(false); setNotPaid(false);
    let result;
    try {
      result = await payWithRazorpay(h.payment, { name: paid?.hostName ?? "", description: paid?.deposit ? t(locale, "depositDescription", { event: paid.eventName }) : paid?.eventName ?? "", prefill: h.prefill });
    } catch {
      setHeld(h);
      setCheckoutFailed(true);
      return;
    }
    if (!result) { setHeld(h); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/bookings/pay", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ manageToken: h.manageToken, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }),
      });
      // Razorpay says the payment didn't complete: stay here with the hold and let the guest try again.
      if (res.status === 400 && (await res.json().catch(() => ({}))).error === "not_paid") {
        setBusy(false); setNotPaid(true); setHeld(h);
        return;
      }
    } catch {
      // The reconciler confirms a real payment within a minute even if this call never arrives.
    }
    router.push(`/${slug}/${event}/booked/${h.bookingId}${langQuery}`);
  }
  const start = new Date(slot);
  const device = useDeviceZone();
  const cycle = useTimeFormat();
  const zone = zoneCheck(start, tz, device, host, cycle);
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const [zoneError, setZoneError] = useState(false);
  const [weeks, setWeeks] = useState(1);
  const [weeksTaken, setWeeksTaken] = useState<string[] | null>(null);
  const [packageRefused, setPackageRefused] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (zone.confirm && !zoneConfirmed) { setZoneError(true); document.getElementById("zone-confirm")?.focus(); return; }
    const data = new FormData(e.currentTarget);
    const answers = Object.fromEntries(questions.map((q) => [q.id, String(data.get(`q_${q.id}`) ?? "")]));
    setBusy(true); setFailed(false); setLimited(false); setExpired(false); setWeeksTaken(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(linkToken ? { linkToken } : { slug, event }), start: slot, name: data.get("name"), email: data.get("email"), phone: data.get("phone") || undefined, timezone: tz, answers, idempotencyKey, ...(weeks > 1 ? { weeks } : {}), ...(packageToken ? { packageToken } : {}) }),
      });
      const body = await res.json();
      if ((res.status === 201 || res.status === 200) && body.payment) {
        setBusy(false);
        const prefill = { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), ...(data.get("phone") ? { contact: String(data.get("phone")) } : {}) };
        await pay({ bookingId: body.bookingId, manageToken: body.manageToken, payment: body.payment, prefill });
        return;
      }
      if (res.status === 201 || res.status === 200) {
        router.push(`/${slug}/${event}/booked/${body.bookingId}${langQuery}`);
        return;
      }
      if (typeof body.error === "string" && body.error.startsWith("link_")) setLinkGone(body.error);
      else if (typeof body.error === "string" && body.error.startsWith("package_")) setPackageRefused(body.error);
      else if (res.status === 409 && body.error === "payments_unavailable") setUnavailable(true);
      else if (res.status === 409 && body.error === "weeks_unavailable") setWeeksTaken(body.unavailable ?? []);
      else if ((res.status === 409 && body.error === "attempt_expired") || res.status === 502) { freshAttempt(); setFailed(true); }
      else if (res.status === 409) { setTaken(body.nextSlots ?? []); setErrors({}); }
      else if (res.status === 400) {
        // Server messages are English; show ours for the fields it names.
        const own: Record<string, GuestKey> = { name: "errName", email: "errEmail", phone: "errPhone", timezone: "errTimezone" };
        const fields = (body.fields ?? {}) as Record<string, string>;
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, own[k] ? t(locale, own[k]) : k.startsWith("answers.") ? t(locale, "errAnswer") : v])));
      }
      else if (res.status === 429) setLimited(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 grid max-w-md gap-4">
      <div>
        <p className="font-semibold text-text">{formatDate(start, tz, locale)}, <LocalTime date={start} tz={tz} locale={locale} /> {zoneName(tz)}</p>
        {zone.hostLine && <p className="text-sm text-text-muted">{t(locale, "thatsHost", { time: formatTime(start, host.timezone, cycle, locale), zone: zoneName(host.timezone), name: host.name.split(/\s+/)[0] || host.name })}</p>}
        <button type="button" onClick={onBack} className={`min-h-11 text-sm font-semibold text-accent underline ${focusRing}`}>{t(locale, "pickAnother")}</button>
      </div>
      {zone.confirm && (
        <div className={`grid gap-2 rounded-md p-4 ${zoneError ? "bg-danger-bg" : "bg-warning-bg"}`}>
          <p className="text-text">
            {t(locale, "zoneMismatch", { zone: zoneName(tz), device: zoneName(device as string) })}
          </p>
          <label className="flex min-h-11 items-start gap-3 text-text">
            <input
              id="zone-confirm" type="checkbox" checked={zoneConfirmed} aria-invalid={zoneError || undefined} aria-describedby={zoneError ? "zone-confirm-error" : undefined}
              onChange={(e) => { setZoneConfirmed(e.target.checked); setZoneError(false); }}
              className={`mt-1 h-5 w-5 accent-accent ${focusRing}`}
            />
            <span>{t(locale, "zoneConfirm", { zone: zoneName(tz) })}</span>
          </label>
          {zoneError && <p id="zone-confirm-error" className="text-sm text-danger" role="alert">{t(locale, "zoneError")}</p>}
        </div>
      )}
      {taken && (
        <div className="rounded-md bg-danger-bg p-4" role="alert">
          <p className="text-danger">{t(locale, "justTaken")}</p>
          <ul className="mt-2 grid gap-2">
            {taken.map((s) => (
              <li key={s}>
                <Button variant="secondary" className="w-full" onClick={() => { setTaken(null); onPick(s); }}>
                  {formatDate(new Date(s), tz, locale)}, <LocalTime date={s} tz={tz} locale={locale} /> {zoneName(tz)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {maxWeeks > 1 && (
        <div>
          <Label htmlFor="weeks">{t(locale, "repeat")}</Label>
          <select
            id="weeks" value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setWeeksTaken(null); }}
            className={`mt-1 block h-11 w-full rounded-md border border-border-input bg-card px-3 text-base text-text ${focusRing}`}
          >
            <option value={1}>{t(locale, "justOnce")}</option>
            {Array.from({ length: maxWeeks - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{t(locale, "everyWeek", { n })}</option>)}
          </select>
        </div>
      )}
      {weeksTaken && (
        <div className="rounded-md bg-danger-bg p-4" role="alert">
          <p className="text-danger">{t(locale, weeksTaken.length === 1 ? "weekTakenOne" : "weekTakenMany")}</p>
          <ul className="mt-2 list-disc pl-5 text-text">
            {weeksTaken.map((s) => <li key={s}>{formatDate(new Date(s), tz, locale)}</li>)}
          </ul>
          <p className="mt-2 text-text">{t(locale, "fewerWeeks")}</p>
        </div>
      )}
      <div><Label htmlFor="name">{t(locale, "yourName")}</Label><Input id="name" name="name" autoComplete="name" required maxLength={100} error={errors.name} /></div>
      <div><Label htmlFor="email">{t(locale, "email")}</Label><Input id="email" name="email" type="email" autoComplete="email" required error={errors.email} /></div>
      <div><Label htmlFor="phone">{t(locale, "phoneOptional")}</Label><Input id="phone" name="phone" type="tel" autoComplete="tel" error={errors.phone} /></div>
      {questions.map((q) => {
        const id = `q_${q.id}`;
        const err = errors[`answers.${q.id}`];
        return (
          <div key={q.id}>
            <Label htmlFor={id}>{q.required ? q.label : t(locale, "optionalLabel", { label: q.label })}</Label>
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
      {linkGone && (
        <p className="text-danger" role="alert">
          {t(locale, linkGone === "link_used" ? "linkUsed" : "linkGone")}
        </p>
      )}
      {packageRefused && (
        <p className="text-danger" role="alert">
          {t(locale, packageRefused === "package_used_up" ? "packageUsedUp" : packageRefused === "package_expired" ? "packageExpired" : "packageOther")}
        </p>
      )}
      {limited && <p className="text-danger" role="alert">{t(locale, "rateLimited")}</p>}
      {failed && <p className="text-danger" role="alert">{t(locale, "failed")}</p>}
      {expired && <p className="text-danger" role="alert">{t(locale, "holdExpired")}</p>}
      {unavailable && <p className="text-danger" role="alert">{t(locale, "paymentsUnavailable", { host: paid?.hostName ?? t(locale, "thisHost") })}</p>}
      {held ? (
        <div className="grid gap-2 rounded-md bg-warning-bg p-4" role="status">
          <p className="text-text">
            {t(locale, checkoutFailed ? "checkoutFailed" : notPaid ? "notPaid" : "notPaidYet")}{" "}
            {tNodes(locale, "heldUntil", { time: <LocalTime date={held.payment.holdExpiresAt} tz={tz} locale={locale} /> })}
          </p>
          <Button type="button" loading={busy} onClick={() => { const h = held; setHeld(null); void pay(h); }}>{t(locale, "pay", { price: paid?.price ?? "" })}</Button>
        </div>
      ) : (
        <Button type="submit" loading={busy}>{busy ? t(locale, "booking") : paid ? t(locale, paid.deposit ? "continuePayDeposit" : "continuePay", { price: paid.price }) : packageToken ? (weeks > 1 ? t(locale, "bookSessions", { n: weeks }) : t(locale, "bookWithPackage")) : t(locale, "bookThisTime")}</Button>
      )}
    </form>
  );
}
