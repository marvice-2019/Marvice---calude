"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OtpStep } from "@/components/OtpStep";
import { PHONE_ERR, PHONE_RE } from "@/lib/format";

/** S05 sign in with phone OTP (DRV-03). Only same-site paths are accepted as the return target. */
export function SignIn({ next }: { next: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/passes";

  return (
    <section className="panelpage">
      <h1>Sign in</h1>
      <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>Use the mobile number you book with. Passes bought as a guest show up automatically.</p>
      {sent ? <div style={{ marginTop: 16 }}><OtpStep phone={phone} onChangePhone={() => setSent(false)} onDone={() => router.push(target)} /></div> : (
        <form className="stack" noValidate onSubmit={e => { e.preventDefault(); if (!PHONE_RE.test(phone)) { setErr(PHONE_ERR); return; } setErr(""); setSent(true); }}>
          <div className="field"><label htmlFor="phone">Mobile number</label>
            <input id="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="err" role="alert">{err}</div>
          <button className="btn" type="submit">Send code</button>
        </form>
      )}
    </section>
  );
}
