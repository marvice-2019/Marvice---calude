"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Gateway, type GatewayResult } from "@/components/Gateway";
import { PassCard } from "@/components/PassCard";
import { useMounted, useNow, useOnline, useSession } from "@/components/hooks";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import type { Booking, GatewayOrder } from "@/lib/contract";
import { clock, inr } from "@/lib/format";
import { cachedPasses, cachePasses, getSession } from "@/lib/session";
import { track } from "@/lib/track";

/** S04 Passes: DRV-10, DRV-11, DRV-12, GST-02. Passes are cached on this device for offline viewing. */
export function PassesView() {
  const mounted = useMounted();
  const session = useSession();
  const online = useOnline();
  const now = useNow();
  const [list, setList] = useState<Booking[] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [ext, setExt] = useState<{ order: GatewayOrder; id: string; newEnd: string } | null>(null);

  const load = useCallback(async () => {
    setErr("");
    const userId = getSession()?.user.id;
    try {
      const r = await api.bookings();
      setList(r); if (userId) cachePasses(userId, r);
    } catch (e) {
      const cached = cachedPasses(userId);
      if (cached) setList(cached);
      setErr(e instanceof ApiFailure ? e.message : "Couldn't load passes.");
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (session) void load();
    else setList(null); // signed out: never show a cached list (shared devices)
  }, [mounted, session, load]);

  async function extend(b: Booking) {
    setBusy(b.id); setMsg("");
    try {
      const r = await api.extend(b.id, newIdempotencyKey());
      setExt({ order: r.razorpay_order, id: b.id, newEnd: r.new_end });
    } catch (e) { setMsg(e instanceof ApiFailure ? e.message : "Couldn't extend. Try again."); }
    finally { setBusy(""); }
  }

  const onExtendPaid = useCallback((r: GatewayResult) => {
    const x = ext; setExt(null);
    if (r !== "success" || !x) { setMsg(r === "failed" ? "Payment didn't go through. You weren't charged." : "Extension cancelled. You weren't charged."); return; }
    track("pass_extended", { hours: 1, amount: x.order.amount });
    setMsg(`Extended to ${clock(x.newEnd)} for ${inr(x.order.amount)} incl. GST. It shows here once the payment confirms.`);
    setTimeout(() => void load(), 2500);
  }, [ext, load]);

  async function cancel(b: Booking) {
    if (!window.confirm(`Cancel pass ${b.code}? You get a full refund.`)) return;
    setBusy(b.id); setMsg("");
    try {
      const r = await api.cancel(b.id, newIdempotencyKey());
      track("pass_cancelled", { amount: r.refund.amount_paise });
      setMsg(r.refund.message);
      await load();
    } catch (e) { setMsg(e instanceof ApiFailure ? e.message : "Couldn't cancel. Try again."); }
    finally { setBusy(""); }
  }

  return (
    <section>
      <div className="intro"><h1>My passes</h1><p>Show the entry code at the gate. You can extend a live pass or cancel free before it starts.</p></div>
      <div className="ok" role="status" style={{ marginTop: 10 }}>{msg}</div>
      {err && list && <div className="err" role="alert">{online ? err : "You're offline. Showing passes saved on this device."}</div>}
      <div className="passes" style={{ marginTop: 18 }} aria-live="polite">
        {!mounted ? <div className="skel" aria-hidden="true" /> :
          !session && !list ? (
            <div className="empty">Sign in with your mobile number to see your passes, including any you bought as a guest.
              <div style={{ marginTop: 12 }}><Link className="btn" href="/signin?next=/passes" style={{ width: "auto" }}>Sign in</Link></div></div>
          ) : list === null ? (err ? <div className="errbox" role="alert">{err}<button className="btn ghost" type="button" onClick={load}>Try again</button></div> : <div className="skel" aria-hidden="true" />)
          : list.length === 0 ? <div className="empty">No passes yet. Find a lot and book; your pass shows up here and on WhatsApp.</div>
          : list.map(b => <PassCard key={b.id} b={b} now={now} busy={busy === b.id || !online} onExtend={() => extend(b)} onCancel={() => cancel(b)} />)}
      </div>
      {ext && <Gateway order={ext.order} contact={session?.user.phone.replace(/^\+91/, "") ?? ""} method="upi" description="Extend 1 hour" onResult={onExtendPaid} />}
    </section>
  );
}
