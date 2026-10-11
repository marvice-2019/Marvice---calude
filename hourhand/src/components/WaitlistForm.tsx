"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { dayKey } from "@/lib/format";
import { useDeviceZone } from "./SlotPicker";

/** "Day full? Get an email if a time opens": the guest's day, in their zone, to the waitlist. */
export function WaitlistForm({ slug, event, hostName }: { slug: string; event: string; hostName: string }) {
  const tz = useDeviceZone();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!tz) return null;
  const today = dayKey(new Date(), tz);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    setErrors({});
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, event, timezone: tz, day: f.get("day"), name: f.get("name"), email: f.get("email") }),
      });
      if (res.ok) return setState("done");
      const body = await res.json().catch(() => ({}));
      setErrors(body.fields ?? { form: res.status === 429 ? "Too many tries. Wait a few minutes and try again." : "That didn't work. Try again." });
    } catch {
      setErrors({ form: "Couldn't reach Hourhand. Check your connection and try again." });
    }
    setState("idle");
  }

  return (
    <details className="mt-6 rounded-md border border-border p-4">
      <summary className={`min-h-11 cursor-pointer content-center font-semibold text-text ${focusRing}`}>Day full? Get an email if a time opens</summary>
      {state === "done" ? (
        <p role="status" className="mt-3 text-text">You&apos;re on the list. If a time with {hostName} opens on that day, we&apos;ll email you once.</p>
      ) : (
        <form onSubmit={submit} className="mt-3 grid gap-3" noValidate>
          <div>
            <Label htmlFor="wl-day">Day</Label>
            <Input id="wl-day" name="day" type="date" min={today} defaultValue={today} required error={errors.day} />
          </div>
          <div>
            <Label htmlFor="wl-name">Your name</Label>
            <Input id="wl-name" name="name" autoComplete="name" required maxLength={100} error={errors.name} />
          </div>
          <div>
            <Label htmlFor="wl-email">Email</Label>
            <Input id="wl-email" name="email" type="email" autoComplete="email" required error={errors.email} />
          </div>
          {(errors.form || errors.timezone) && <p role="alert" className="text-sm text-danger">{errors.form ?? errors.timezone}</p>}
          <Button type="submit" disabled={state === "sending"}>{state === "sending" ? "Adding you…" : "Join the waitlist"}</Button>
        </form>
      )}
    </details>
  );
}
