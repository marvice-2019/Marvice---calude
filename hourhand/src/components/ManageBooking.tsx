"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { formatDate, zoneName } from "@/lib/format";
import { LocalTime } from "./LocalTime";
import { SlotPicker } from "./SlotPicker";

interface Props {
  token: string;
  slug: string;
  event: string;
  bookingWindowDays: number;
  hostName: string;
}

function When({ slot, tz }: { slot: string; tz: string }) {
  return <>{formatDate(new Date(slot), tz)}, <LocalTime date={slot} tz={tz} /> {zoneName(tz)}</>;
}

/** The two things a guest can do with a booking: move it, or cancel it. */
export function ManageBooking({ token, slug, event, bookingWindowDays, hostName }: Props) {
  return (
    <>
      <Reschedule token={token} slug={slug} event={event} bookingWindowDays={bookingWindowDays} />
      <Cancel token={token} hostName={hostName} />
    </>
  );
}

function Reschedule({ token, slug, event, bookingWindowDays }: Omit<Props, "hostName">) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [picked, setPicked] = useState<{ slot: string; tz: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

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
        router.push(`/${slug}/${event}/booked/${body.bookingId}`);
        return;
      }
      if (res.status === 409 && body.error === "slot_taken") setTaken(body.nextSlots ?? []);
      else if (res.status === 409) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="reschedule-heading" className="mt-8">
      <h2 id="reschedule-heading" className="font-semibold text-text">Reschedule</h2>
      <div hidden={picked !== null}>
        <SlotPicker slug={slug} event={event} bookingWindowDays={bookingWindowDays} manageToken={token} onPick={(slot, tz) => setPicked({ slot, tz })} />
      </div>
      {picked && (
        <div className="mt-4 grid max-w-md gap-3">
          <p className="text-text">New time: <span className="font-semibold"><When slot={picked.slot} tz={picked.tz} /></span></p>
          {taken && (
            <div className="rounded-md bg-danger-bg p-4" role="alert">
              <p className="text-danger">That time was just taken. Here are the next open times:</p>
              <ul className="mt-2 grid gap-2">
                {taken.map((s) => (
                  <li key={s}>
                    <Button variant="secondary" className="w-full" onClick={() => { setTaken(null); setPicked({ slot: s, tz: picked.tz }); }}>
                      <When slot={s} tz={picked.tz} />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failed && <p className="text-danger" role="alert">Something went wrong. Your booking hasn&apos;t moved. Try again.</p>}
          <Button onClick={confirm} loading={busy}>{busy ? "Moving…" : "Move my booking to this time"}</Button>
          <button type="button" onClick={() => { setPicked(null); setTaken(null); }} className={`min-h-11 justify-self-start text-sm font-semibold text-accent underline ${focusRing}`}>
            Pick another time
          </button>
        </div>
      )}
    </section>
  );
}

function Cancel({ token, hostName }: { token: string; hostName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/b/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }),
      });
      const body = await res.json();
      if (res.ok) {
        router.refresh();
        return;
      }
      if (body.error === "past_cutoff") setError(`This booking can't be cancelled online this close to the start. Contact ${hostName} directly.`);
      else if (res.status === 400) setError(body.fields?.reason ?? "Check the reason and try again.");
      else setError("Something went wrong. Your booking is still on. Try again.");
    } catch {
      setError("Something went wrong. Your booking is still on. Try again.");
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="cancel-heading" className="mt-10 max-w-md">
      <h2 id="cancel-heading" className="font-semibold text-text">Cancel</h2>
      <form onSubmit={submit} className="mt-2 grid gap-3">
        <div>
          <Label htmlFor="reason">Reason (optional)</Label>
          <textarea
            id="reason" name="reason" rows={3} maxLength={500}
            className={`mt-1 block w-full rounded-md border border-border-input bg-card p-3 text-base text-text ${focusRing}`}
          />
        </div>
        {error && <p className="text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="danger" loading={busy}>{busy ? "Cancelling…" : "Cancel booking"}</Button>
      </form>
    </section>
  );
}
