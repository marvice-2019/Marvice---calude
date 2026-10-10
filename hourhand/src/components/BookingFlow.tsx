"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { formatDate, formatTime, zoneName } from "@/lib/format";
import { SlotPicker } from "./SlotPicker";

export interface FlowQuestion { id: string; label: string; kind: string; required: boolean }

interface Props {
  slug: string;
  event: string;
  bookingWindowDays: number;
  questions: FlowQuestion[];
}

/** Public booking: pick a time, then fill in details. The picker stays mounted so "Pick another time" keeps the month and day. */
export function BookingFlow({ slug, event, bookingWindowDays, questions }: Props) {
  const [picked, setPicked] = useState<{ slot: string; tz: string } | null>(null);
  return (
    <>
      <div hidden={picked !== null}>
        <SlotPicker slug={slug} event={event} bookingWindowDays={bookingWindowDays} onPick={(slot, tz) => setPicked({ slot, tz })} />
      </div>
      {picked && (
        <DetailsForm
          slug={slug} event={event} tz={picked.tz} slot={picked.slot} questions={questions}
          onPick={(slot) => setPicked({ slot, tz: picked.tz })} onBack={() => setPicked(null)}
        />
      )}
    </>
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
