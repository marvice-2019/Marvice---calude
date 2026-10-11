"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { formatDate, zoneName } from "@/lib/format";
import { zoneCheck } from "@/lib/tz-confirm";
import { LocalTime } from "./LocalTime";
import { payWithRazorpay, type CheckoutPayment } from "./razorpay-checkout";
import { SlotPicker, useDeviceZone } from "./SlotPicker";
import { useTimeFormat } from "./useTimeFormat";

export interface FlowQuestion { id: string; label: string; kind: string; required: boolean }

interface Props {
  slug: string;
  event: string;
  bookingWindowDays: number;
  questions: FlowQuestion[];
  /** For a priced event: the price as shown ("₹499") and the names Checkout shows the guest. */
  paid?: { price: string; hostName: string; eventName: string } | null;
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
}

/** Public booking: pick a time, then fill in details. The picker stays mounted so "Pick another time" keeps the month and day. */
export function BookingFlow({ slug, event, bookingWindowDays, questions, paid = null, linkToken, initialAt, host, maxWeeks = 1, packageToken }: Props) {
  const [picked, setPicked] = useState<{ slot: string; tz: string } | null>(null);
  return (
    <>
      <div hidden={picked !== null}>
        <SlotPicker slug={slug} event={event} linkToken={linkToken} initialAt={initialAt} bookingWindowDays={bookingWindowDays} onPick={(slot, tz) => setPicked({ slot, tz })} />
      </div>
      {picked && (
        <DetailsForm
          slug={slug} event={event} linkToken={linkToken} tz={picked.tz} slot={picked.slot} questions={questions} paid={packageToken ? null : paid} host={host} maxWeeks={maxWeeks} packageToken={packageToken}
          onPick={(slot) => setPicked({ slot, tz: picked.tz })} onBack={() => setPicked(null)}
        />
      )}
    </>
  );
}

interface FormProps {
  slug: string; event: string; linkToken?: string; tz: string; slot: string; questions: FlowQuestion[]; paid: Props["paid"]; host: Props["host"]; maxWeeks: number; packageToken?: string;
  onPick: (slot: string) => void; onBack: () => void;
}

function DetailsForm({ slug, event, linkToken, tz, slot, questions, paid, host, maxWeeks, packageToken, onPick, onBack }: FormProps) {
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
      result = await payWithRazorpay(h.payment, { name: paid?.hostName ?? "", description: paid?.eventName ?? "", prefill: h.prefill });
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
    router.push(`/${slug}/${event}/booked/${h.bookingId}`);
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
        router.push(`/${slug}/${event}/booked/${body.bookingId}`);
        return;
      }
      if (typeof body.error === "string" && body.error.startsWith("link_")) setLinkGone(body.error);
      else if (typeof body.error === "string" && body.error.startsWith("package_")) setPackageRefused(body.error);
      else if (res.status === 409 && body.error === "payments_unavailable") setUnavailable(true);
      else if (res.status === 409 && body.error === "weeks_unavailable") setWeeksTaken(body.unavailable ?? []);
      else if ((res.status === 409 && body.error === "attempt_expired") || res.status === 502) { freshAttempt(); setFailed(true); }
      else if (res.status === 409) { setTaken(body.nextSlots ?? []); setErrors({}); }
      else if (res.status === 400) setErrors(body.fields ?? {});
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
        <p className="font-semibold text-text">{formatDate(start, tz)}, <LocalTime date={start} tz={tz} /> {zoneName(tz)}</p>
        {zone.hostLine && <p className="text-sm text-text-muted">That&apos;s {zone.hostLine}.</p>}
        <button type="button" onClick={onBack} className={`min-h-11 text-sm font-semibold text-accent underline ${focusRing}`}>Pick another time</button>
      </div>
      {zone.confirm && (
        <div className={`grid gap-2 rounded-md p-4 ${zoneError ? "bg-danger-bg" : "bg-warning-bg"}`}>
          <p className="text-text">
            These times are in {zoneName(tz)}, but your device is set to {zoneName(device as string)}.
          </p>
          <label className="flex min-h-11 items-start gap-3 text-text">
            <input
              id="zone-confirm" type="checkbox" checked={zoneConfirmed} aria-invalid={zoneError || undefined} aria-describedby={zoneError ? "zone-confirm-error" : undefined}
              onChange={(e) => { setZoneConfirmed(e.target.checked); setZoneError(false); }}
              className={`mt-1 h-5 w-5 accent-accent ${focusRing}`}
            />
            <span>I&apos;ll be in {zoneName(tz)} at that time</span>
          </label>
          {zoneError && <p id="zone-confirm-error" className="text-sm text-danger" role="alert">Confirm your time zone, or pick another time in your own.</p>}
        </div>
      )}
      {taken && (
        <div className="rounded-md bg-danger-bg p-4" role="alert">
          <p className="text-danger">That time was just taken. Here are the next open times:</p>
          <ul className="mt-2 grid gap-2">
            {taken.map((s) => (
              <li key={s}>
                <Button variant="secondary" className="w-full" onClick={() => { setTaken(null); onPick(s); }}>
                  {formatDate(new Date(s), tz)}, <LocalTime date={s} tz={tz} /> {zoneName(tz)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {maxWeeks > 1 && (
        <div>
          <Label htmlFor="weeks">Repeat</Label>
          <select
            id="weeks" value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setWeeksTaken(null); }}
            className={`mt-1 block h-11 w-full rounded-md border border-border-input bg-card px-3 text-base text-text ${focusRing}`}
          >
            <option value={1}>Just this once</option>
            {Array.from({ length: maxWeeks - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>Every week for {n} weeks</option>)}
          </select>
        </div>
      )}
      {weeksTaken && (
        <div className="rounded-md bg-danger-bg p-4" role="alert">
          <p className="text-danger">Nothing is booked yet: {weeksTaken.length === 1 ? "this week isn't" : "these weeks aren't"} free at this time.</p>
          <ul className="mt-2 list-disc pl-5 text-text">
            {weeksTaken.map((s) => <li key={s}>{formatDate(new Date(s), tz)}</li>)}
          </ul>
          <p className="mt-2 text-text">Pick fewer weeks, or another time.</p>
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
      {linkGone && (
        <p className="text-danger" role="alert">
          {linkGone === "link_used" ? "Someone has already booked with this link. If that was you, check your email for the confirmation." : "This link doesn't work any more. Ask the person who sent it for a new one."}
        </p>
      )}
      {packageRefused && (
        <p className="text-danger" role="alert">
          {packageRefused === "package_used_up" ? "Your package has no sessions left. Cancel one you've booked to free it, or buy another package."
            : packageRefused === "package_expired" ? "That time is after your package's end date. Pick an earlier time."
            : "This package can't book right now. Check the link in your email."}
        </p>
      )}
      {limited && <p className="text-danger" role="alert">Too many bookings from here in the last hour. Try again later.</p>}
      {failed && <p className="text-danger" role="alert">Something went wrong. Your time isn&apos;t booked yet. Try again.</p>}
      {expired && <p className="text-danger" role="alert">Your hold on this time ran out before payment. Book it again if it&apos;s still free.</p>}
      {unavailable && <p className="text-danger" role="alert">{paid?.hostName ?? "This host"} isn&apos;t taking payments online right now, so this event can&apos;t be booked here. Contact them directly.</p>}
      {held ? (
        <div className="grid gap-2 rounded-md bg-warning-bg p-4" role="status">
          <p className="text-text">
            {checkoutFailed ? "Razorpay didn't open. Check your connection and try again." : notPaid ? "That payment didn't go through. Try again, or use another way to pay." : "You haven't paid yet."} Your time is held until{" "}
            <LocalTime date={held.payment.holdExpiresAt} tz={tz} />.
          </p>
          <Button type="button" loading={busy} onClick={() => { const h = held; setHeld(null); void pay(h); }}>Pay {paid?.price}</Button>
        </div>
      ) : (
        <Button type="submit" loading={busy}>{busy ? "Booking…" : paid ? `Continue to pay ${paid.price}` : packageToken ? (weeks > 1 ? `Book ${weeks} sessions` : "Book with your package") : "Book this time"}</Button>
      )}
    </form>
  );
}
