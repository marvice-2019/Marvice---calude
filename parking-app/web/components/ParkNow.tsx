"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { cleanPlate, PLATE, rupees } from "@/lib/format";
import { pay } from "@/lib/pay";
import { nextQuarter } from "@/lib/time";
import type { CreateBookingResponse, LotSummary, Quote } from "@/lib/types";
import { Bill } from "./Checkout";
import { SignIn } from "./SignIn";
import { useMe } from "./useMe";

const HOURS = [1, 2, 3, 4, 6, 8];

// DRV-09: digits-only code from the board → hours → pay. Three taps for a returning driver.
export function ParkNow() {
  const router = useRouter();
  const { me, reload } = useMe();
  const [code, setCode] = useState(""), [lot, setLot] = useState<Pick<LotSummary, "id" | "name" | "code" | "address" | "status"> | null>(null);
  const [hours, setHours] = useState(2), [quote, setQuote] = useState<Quote | null>(null);
  const [plate, setPlate] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const plateValue = plate || me?.vehicles[0]?.plate || "";

  async function quoteFor(id: string, h: number) {
    const from = nextQuarter(new Date(Date.now() - 14 * 60_000)), to = new Date(from.getTime() + h * 3_600_000);
    try { setQuote(await api<Quote>("/v1/quotes", { method: "POST", body: { lot_id: id, from: from.toISOString(), to: to.toISOString(), vehicle: "car" } })); }
    catch { setQuote(null); }
  }
  async function find(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLot(null); setQuote(null);
    if (!/^\d{3,5}$/.test(code)) return setErr("The lot number is 3 to 5 digits, on the board at the entrance.");
    try {
      const r = await api<{ lot: NonNullable<typeof lot> }>(`/v1/lots/by-code/${code}`);
      if (r.lot.status !== "open") return setErr(`${r.lot.name} isn't taking cars right now (${r.lot.status.replace("_", " ")}).`);
      setLot(r.lot); quoteFor(r.lot.id, hours);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't look that up. Try again."); }
  }
  async function book() {
    if (!lot) return;
    setErr("");
    const p = cleanPlate(plateValue);
    if (!PLATE.test(p)) return setErr("Enter the number plate like KA01AB1234.");
    setBusy(true);
    try {
      const res = await api<CreateBookingResponse>("/v1/bookings", { method: "POST", idempotent: true, body: { lot_id: lot.id, source: "park_now", hours, plate: p } });
      const out = await pay(res.razorpay_order, { contact: me?.user.phone }, `${lot.name} · Park now`);
      if (out === "paid") return router.push(`/passes?new=${res.booking.id}`);
      setErr(out === "cancelled" ? "Payment window closed. Tap Pay to try again." : "The payment didn't go through. No money was taken.");
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Something went wrong. Try again."); }
    setBusy(false);
  }

  return (
    <div className="panel card">
      <form onSubmit={find} className="field" noValidate>
        <label htmlFor="code">Lot number</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="code" className="input mono" inputMode="numeric" autoFocus maxLength={5} placeholder="101" style={{ fontSize: 28, letterSpacing: ".2em" }}
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} aria-describedby="pn-err" />
          <button className="btn kerb">Find</button>
        </div>
      </form>
      {lot && (
        <>
          <div className="list-row"><span><strong>{lot.name}</strong><br /><span className="muted" style={{ fontSize: 14 }}>{lot.address}</span></span><span className="code">{lot.code.replace(/^BLR/, "")}</span></div>
          <div className="field">
            <span className="label" id="h-l">How long?</span>
            <div className="chips" role="group" aria-labelledby="h-l">
              {HOURS.map(h => <button key={h} type="button" className="chip soft" aria-pressed={hours === h} onClick={() => { setHours(h); quoteFor(lot.id, h); }}>{h} h</button>)}
            </div>
          </div>
          {quote && <Bill q={quote} />}
          {me === null ? <SignIn title="Sign in to pay" onDone={reload} /> : (
            <>
              <div className="field"><label htmlFor="pn-plate">Number plate</label>
                <input id="pn-plate" className="input mono" value={plateValue} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="KA01AB1234" maxLength={13} /></div>
              <button className="btn block" onClick={book} disabled={busy || !quote || me === undefined}>{busy ? "Opening payment…" : quote ? `Pay ${rupees(quote.totalPaise)}` : "Pay"}</button>
            </>
          )}
        </>
      )}
      <p className="err" id="pn-err" role="alert">{err}</p>
    </div>
  );
}
