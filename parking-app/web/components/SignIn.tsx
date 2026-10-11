"use client";
import { useState } from "react";
import { ApiFailure, authCall } from "@/lib/api";
import { PHONE } from "@/lib/format";

// Inline phone OTP (DRV-07): no separate sign-up page, so checkout never loses the driver's place.
export function SignIn({ onDone, title = "Sign in with your phone" }: { onDone: () => void; title?: string }) {
  const [phone, setPhone] = useState(""), [otp, setOtp] = useState(""), [sent, setSent] = useState(false);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!PHONE.test(phone)) return setErr("Enter a 10-digit Indian mobile number.");
    setBusy(true);
    try { await authCall("otp", { phone }); setSent(true); } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't send the code. Try again."); }
    setBusy(false);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!/^\d{6}$/.test(otp)) return setErr("The code is 6 digits.");
    setBusy(true);
    try { await authCall("verify", { phone, otp }); onDone(); } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't verify. Try again."); setBusy(false); }
  }

  return (
    <form className="panel card" onSubmit={sent ? verify : send} noValidate>
      <h2 style={{ fontSize: 24 }}>{title}</h2>
      <p className="muted" style={{ margin: 0 }}>We text a 6-digit code. Your pass and receipts stay on this number.</p>
      <div className="field">
        <label htmlFor="phone">Mobile number</label>
        <input id="phone" className="input mono" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="98450 12345"
          value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} disabled={sent} aria-describedby="signin-err" />
      </div>
      {sent && (
        <div className="field">
          <label htmlFor="otp">Code from SMS</label>
          <input id="otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
            value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} aria-describedby="signin-err" />
        </div>
      )}
      <p className="err" id="signin-err" role="alert">{err}</p>
      <button className="btn block" disabled={busy}>{busy ? "Please wait…" : sent ? "Verify and continue" : "Send code"}</button>
      {sent && <button type="button" className="link" onClick={() => { setSent(false); setOtp(""); }}>Change number</button>}
    </form>
  );
}
