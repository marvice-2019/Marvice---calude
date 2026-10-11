"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { t, type Locale } from "@/lib/i18n/guest";

const CHOICES = [5, 10, 15, 20, 30];

/** "Running late?": one tap tells the host how late the guest will be; they get an email at once. */
export function RunningLate({ token, hostName, told, locale = "en" }: { token: string; hostName: string; told: number | null; locale?: Locale }) {
  const [sent, setSent] = useState<number | null>(told);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function tell(minutes: number) {
    setBusy(minutes); setFailed(false);
    try {
      const res = await fetch(`/api/b/${encodeURIComponent(token)}/late`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes }),
      });
      if (res.ok) setSent(minutes);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(null);
  }

  return (
    <section aria-labelledby="late-heading" className="mt-6 max-w-md rounded-md bg-surface p-4">
      <h2 id="late-heading" className="font-semibold text-text">{t(locale, "runningLate")}</h2>
      {sent !== null && <p className="mt-1 text-text" role="status">{t(locale, "lateTold", { host: hostName, n: sent })}</p>}
      <p className="mt-1 text-sm text-text-muted">{sent === null ? t(locale, "lateTap", { host: hostName }) : t(locale, "lateChanged")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {CHOICES.map((m) => (
          <Button key={m} variant="secondary" size="sm" loading={busy === m} onClick={() => void tell(m)}>{t(locale, "minutes", { n: m })}</Button>
        ))}
      </div>
      {failed && <p className="mt-2 text-sm text-danger" role="alert">{t(locale, "lateFailed", { host: hostName })}</p>}
    </section>
  );
}
