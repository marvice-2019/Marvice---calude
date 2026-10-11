import { useState } from "react";
import { ApiFailure, auth } from "@/lib/api";
import { PHONE } from "@/shared/format";
import { Button, Card, Field, T } from "./ui";

// Inline phone OTP (DRV-07): sign-in happens where the driver is, so checkout never loses its place.
export function SignIn({ onDone, title = "Sign in with your phone" }: { onDone: () => void; title?: string }) {
  const [phone, setPhone] = useState(""), [otp, setOtp] = useState(""), [sent, setSent] = useState(false);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  async function go() {
    setErr("");
    if (!sent) {
      if (!PHONE.test(phone)) return setErr("Enter a 10-digit Indian mobile number.");
      setBusy(true);
      try { await auth.otp(phone); setSent(true); } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't send the code."); }
      return setBusy(false);
    }
    if (!/^\d{6}$/.test(otp)) return setErr("The code is 6 digits.");
    setBusy(true);
    try { await auth.verify(phone, otp); onDone(); } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't verify."); setBusy(false); }
  }

  return (
    <Card>
      <T variant="title">{title}</T>
      <T variant="muted">We text a 6-digit code. Your pass and receipts stay on this number.</T>
      <Field label="Mobile number" value={phone} onChangeText={v => setPhone(v.replace(/\D/g, "").slice(0, 10))} keyboardType="number-pad"
        autoComplete="tel" textContentType="telephoneNumber" editable={!sent} placeholder="98450 12345" error={sent ? undefined : err} />
      {sent && <Field label="Code from SMS" value={otp} onChangeText={v => setOtp(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad"
        autoComplete="sms-otp" textContentType="oneTimeCode" autoFocus error={err} />}
      <Button title={sent ? "Verify and continue" : "Send code"} onPress={go} busy={busy} />
      {sent && <Button kind="ghost" title="Change number" onPress={() => { setSent(false); setOtp(""); setErr(""); }} />}
    </Card>
  );
}
