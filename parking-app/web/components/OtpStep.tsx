"use client";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import type { Session } from "@/lib/contract";

/** Phone OTP (DRV-03). `phone` is a validated 10-digit number; the code is sent as soon as this mounts. */
export function OtpStep({ phone, onDone, onChangePhone }: { phone: string; onDone: (s: Session) => void; onChangePhone?: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(30);
  const [sentAt, setSentAt] = useState(0);

  useEffect(() => {
    let live = true;
    api.requestOtp(phone).then(() => live && setSentAt(Date.now()))
      .catch(e => live && setErr(e instanceof ApiFailure ? e.message : "Couldn't send the code. Try again."));
    return () => { live = false; };
  }, [phone]);

  useEffect(() => {
    if (!sentAt) return;
    setWait(30);
    const t = setInterval(() => setWait(w => (w > 0 ? w - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [sentAt]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setErr("Enter the 6-digit code from the SMS."); return; }
    setBusy(true); setErr("");
    try { onDone(await api.verifyOtp(phone, code)); }
    catch (e2) { setErr(e2 instanceof ApiFailure ? e2.message : "Couldn't verify. Try again."); }
    finally { setBusy(false); }
  }

  async function resend() {
    setErr("");
    try { await api.requestOtp(phone); setSentAt(Date.now()); }
    catch (e) { setErr(e instanceof ApiFailure ? e.message : "Couldn't send the code. Try again."); }
  }

  return (
    <form className="stack" onSubmit={verify} noValidate aria-label="Verify your mobile number">
      <p style={{ margin: 0 }}>We sent a 6-digit code to <b className="num">+91 {phone.slice(0, 5)} {phone.slice(5)}</b>.
        {onChangePhone && <> <button type="button" className="btn link" onClick={onChangePhone}>Change number</button></>}</p>
      <div className="field"><label htmlFor="otp">Code from SMS</label>
        <input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></div>
      <div className="err" role="alert">{err}</div>
      <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Verify and continue"}</button>
      <button className="btn ghost" type="button" disabled={wait > 0} onClick={resend}>{wait > 0 ? `Resend code in ${wait} s` : "Resend code"}</button>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>By continuing you agree that Bayline uses your mobile number and vehicle number to issue passes and send them on WhatsApp. Location is used only when you tap to search near you.</div>
    </form>
  );
}
