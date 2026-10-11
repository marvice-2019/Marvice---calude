"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PassCard } from "@/components/PassCard";
import { useNow } from "@/components/hooks";
import { api, ApiFailure } from "@/lib/api";
import type { Booking } from "@/lib/contract";
import { local } from "@/lib/session";

const POLL_MS = 2000, GIVE_UP_MS = 90_000;

/**
 * After the gateway says "paid", the pass exists only once the API has the signed webhook.
 * Poll until the booking is confirmed (or failed). Covers the webhook arriving late.
 */
export function PassWait({ id }: { id: string }) {
  const now = useNow(30_000);
  const [b, setB] = useState<Booking | null>(null);
  const [state, setState] = useState<"waiting" | "ok" | "failed" | "slow" | "error">("waiting");
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const tick = async () => {
      try {
        const list = await api.bookings();
        const found = list.find(x => x.id === id);
        if (found) local("passes", list);
        if (found && found.status === "cancelled") { setB(found); setState("failed"); return; }
        if (found) { setB(found); setState("ok"); return; }
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 401) { setErr(e.message); setState("error"); return; }
      }
      if (stop) return;
      if (Date.now() - started > GIVE_UP_MS) { setState("slow"); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  return (
    <section style={{ maxWidth: 420, marginInline: "auto" }}>
      <div aria-live="polite">
        {state === "waiting" && <div className="panelpage" role="status"><h1>Confirming payment…</h1><p style={{ color: "var(--muted)" }}>This usually takes a few seconds. Don&apos;t pay again.</p><div className="skel" aria-hidden="true" /></div>}
        {state === "slow" && <div className="panelpage" role="status"><h1>Still confirming</h1><p>Your bank hasn&apos;t confirmed yet. We&apos;ll send the pass on WhatsApp as soon as it does. Don&apos;t pay again. If money left your account and no pass arrives within 30 minutes, contact support with the time you paid.</p><Link className="btn ghost" href="/passes">Go to my passes</Link></div>}
        {state === "failed" && <div className="panelpage errbox" role="alert">Payment didn&apos;t go through. You weren&apos;t charged.<Link className="btn" href="/">Find parking</Link></div>}
        {state === "error" && <div className="panelpage errbox" role="alert">{err}<Link className="btn" href="/signin?next=/passes">Sign in</Link></div>}
        {state === "ok" && b && (
          <>
            <p className="ok" role="status" style={{ fontSize: 15, fontWeight: 700 }}>Paid. Pass {b.code} sent to WhatsApp.</p>
            <PassCard b={b} now={now} />
            <p style={{ marginTop: 12 }}><Link href="/passes">All my passes</Link></p>
          </>
        )}
      </div>
    </section>
  );
}
