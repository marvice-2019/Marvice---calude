"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { formatDate, zoneName } from "@/lib/format";
import { LocalTime } from "./LocalTime";
import { SlotPicker } from "./SlotPicker";
import { t, tNodes, type Locale } from "@/lib/i18n/guest";

interface Props {
  token: string;
  slug: string;
  event: string;
  bookingWindowDays: number;
  hostName: string;
  /** Later weeks of this booking's weekly series still to come; 0 when it isn't part of one. */
  laterWeeks?: number;
  locale?: Locale;
  /** "?lang=xx" when the guest chose a language, carried to the next page. */
  langQuery?: string;
}

function When({ slot, tz, locale }: { slot: string; tz: string; locale: Locale }) {
  return <>{formatDate(new Date(slot), tz, locale)}, <LocalTime date={slot} tz={tz} locale={locale} /> {zoneName(tz)}</>;
}

/** The two things a guest can do with a booking: move it, or cancel it. */
export function ManageBooking({ token, slug, event, bookingWindowDays, hostName, laterWeeks = 0, locale = "en", langQuery = "" }: Props) {
  return (
    <>
      <Reschedule token={token} slug={slug} event={event} bookingWindowDays={bookingWindowDays} locale={locale} langQuery={langQuery} />
      <Cancel token={token} hostName={hostName} laterWeeks={laterWeeks} locale={locale} />
    </>
  );
}

function Reschedule({ token, slug, event, bookingWindowDays, locale = "en", langQuery = "" }: Omit<Props, "hostName" | "laterWeeks">) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [picked, setPicked] = useState<{ slot: string; tz: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pastPackage, setPastPackage] = useState(false);

  async function confirm() {
    if (!picked) return;
    setBusy(true); setFailed(false);
    try {
      const res = await fetch(`/api/b/${encodeURIComponent(token)}/reschedule`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ start: picked.slot, idempotencyKey }),
      });
      const body = await res.json();
      if (res.status === 201 || res.status === 200) {
        router.push(`/${slug}/${event}/booked/${body.bookingId}${langQuery}`);
        return;
      }
      if (res.status === 409 && body.error === "slot_taken") setTaken(body.nextSlots ?? []);
      else if (res.status === 409 && body.error === "package_expired") setPastPackage(true);
      else if (res.status === 409) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="reschedule-heading" className="mt-8">
      <h2 id="reschedule-heading" className="font-semibold text-text">{t(locale, "reschedule")}</h2>
      <div hidden={picked !== null}>
        <SlotPicker slug={slug} event={event} bookingWindowDays={bookingWindowDays} manageToken={token} locale={locale} onPick={(slot, tz) => setPicked({ slot, tz })} />
      </div>
      {picked && (
        <div className="mt-4 grid max-w-md gap-3">
          <p className="text-text">{tNodes(locale, "newTime", { when: <span className="font-semibold"><When slot={picked.slot} tz={picked.tz} locale={locale} /></span> })}</p>
          {taken && (
            <div className="rounded-md bg-danger-bg p-4" role="alert">
              <p className="text-danger">{t(locale, "justTaken")}</p>
              <ul className="mt-2 grid gap-2">
                {taken.map((s) => (
                  <li key={s}>
                    <Button variant="secondary" className="w-full" onClick={() => { setTaken(null); setPicked({ slot: s, tz: picked.tz }); }}>
                      <When slot={s} tz={picked.tz} locale={locale} />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failed && <p className="text-danger" role="alert">{t(locale, "moveFailed")}</p>}
          {pastPackage && <p className="text-danger" role="alert">{t(locale, "packageExpired")}</p>}
          <Button onClick={confirm} loading={busy}>{t(locale, busy ? "moving" : "moveHere")}</Button>
          <button type="button" onClick={() => { setPicked(null); setTaken(null); }} className={`min-h-11 justify-self-start text-sm font-semibold text-accent underline ${focusRing}`}>
            {t(locale, "pickAnother")}
          </button>
        </div>
      )}
    </section>
  );
}

function Cancel({ token, hostName, laterWeeks, locale }: { token: string; hostName: string; laterWeeks: number; locale: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const reason = String(data.get("reason") ?? "");
    const alsoLater = data.get("laterWeeks") === "on";
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/b/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, laterWeeks: alsoLater }),
      });
      const body = await res.json();
      if (res.ok) {
        router.refresh();
        return;
      }
      if (body.error === "past_cutoff") setError(t(locale, "pastCutoff", { host: hostName }));
      else if (res.status === 400) setError(t(locale, "checkReason"));
      else setError(t(locale, "cancelFailed"));
    } catch {
      setError(t(locale, "cancelFailed"));
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="cancel-heading" className="mt-10 max-w-md">
      <h2 id="cancel-heading" className="font-semibold text-text">{t(locale, "cancel")}</h2>
      <form onSubmit={submit} className="mt-2 grid gap-3">
        <div>
          <Label htmlFor="reason">{t(locale, "reasonOptional")}</Label>
          <textarea
            id="reason" name="reason" rows={3} maxLength={500}
            className={`mt-1 block w-full rounded-md border border-border-input bg-card p-3 text-base text-text ${focusRing}`}
          />
        </div>
        {laterWeeks > 0 && (
          <label className="flex min-h-11 items-start gap-3 text-text">
            <input type="checkbox" name="laterWeeks" className={`mt-1 h-5 w-5 accent-accent ${focusRing}`} />
            <span>{laterWeeks === 1 ? t(locale, "alsoCancelNext") : t(locale, "alsoCancelLater", { n: laterWeeks })}</span>
          </label>
        )}
        {error && <p className="text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="danger" loading={busy}>{t(locale, busy ? "cancelling" : "cancelBooking")}</Button>
      </form>
    </section>
  );
}
