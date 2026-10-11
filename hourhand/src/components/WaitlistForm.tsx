"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import { dayKey } from "@/lib/format";
import { useDeviceZone } from "./SlotPicker";
import { t, type Locale } from "@/lib/i18n/guest";

/** "Day full? Get an email if a time opens": the guest's day, in their zone, to the waitlist. */
export function WaitlistForm({ slug, event, hostName, locale = "en" }: { slug: string; event: string; hostName: string; locale?: Locale }) {
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
      // Server messages are English; show ours for the fields it names.
      const fields = (body.fields ?? {}) as Record<string, string>;
      const mine: Record<string, string> = { name: t(locale, "errName"), email: t(locale, "errEmail"), day: t(locale, "errDay"), timezone: t(locale, "errTimezone") };
      setErrors(Object.keys(fields).length > 0 ? Object.fromEntries(Object.keys(fields).map((k) => [k, mine[k] ?? fields[k]]))
        : { form: t(locale, res.status === 429 ? "waitlistTooMany" : "waitlistFailed") });
    } catch {
      setErrors({ form: t(locale, "offline") });
    }
    setState("idle");
  }

  return (
    <details className="mt-6 rounded-md border border-border p-4">
      <summary className={`min-h-11 cursor-pointer content-center font-semibold text-text ${focusRing}`}>{t(locale, "waitlistSummary")}</summary>
      {state === "done" ? (
        <p role="status" className="mt-3 text-text">{t(locale, "waitlistDone", { host: hostName })}</p>
      ) : (
        <form onSubmit={submit} className="mt-3 grid gap-3" noValidate>
          <div>
            <Label htmlFor="wl-day">{t(locale, "day")}</Label>
            <Input id="wl-day" name="day" type="date" min={today} defaultValue={today} required error={errors.day} />
          </div>
          <div>
            <Label htmlFor="wl-name">{t(locale, "yourName")}</Label>
            <Input id="wl-name" name="name" autoComplete="name" required maxLength={100} error={errors.name} />
          </div>
          <div>
            <Label htmlFor="wl-email">{t(locale, "email")}</Label>
            <Input id="wl-email" name="email" type="email" autoComplete="email" required error={errors.email} />
          </div>
          {(errors.form || errors.timezone) && <p role="alert" className="text-sm text-danger">{errors.form ?? errors.timezone}</p>}
          <Button type="submit" disabled={state === "sending"}>{t(locale, state === "sending" ? "joining" : "joinWaitlist")}</Button>
        </form>
      )}
    </details>
  );
}
