"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { payWithRazorpay, type CheckoutPayment } from "./razorpay-checkout";

/** Buy a session package: details, then Razorpay Checkout (UPI, cards, netbanking), then the buyer's own page. */
export function PackageCheckout({ packageId, price, hostName, packageName }: { packageId: string; price: string; hostName: string; packageName: string }) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const buyer = { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), phone: String(data.get("phone") ?? "") };
    setBusy(true); setErrors({}); setMessage(null);
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(packageId)}/buy`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...buyer, idempotencyKey }),
      });
      const body = await res.json();
      if (res.status === 400) { setErrors(body.fields ?? {}); return; }
      if (res.status === 409) { setMessage(`${hostName} isn't taking payments online right now. Contact them directly.`); return; }
      if (res.status === 429) { setMessage("Too many tries from here in the last hour. Try again later."); return; }
      if (!res.ok) { setMessage("Something went wrong and nothing was charged. Try again."); return; }
      if (!body.payment) { router.push(`/p/${body.token}`); return; } // already paid
      const result = await payWithRazorpay(body.payment as CheckoutPayment, {
        name: hostName, description: packageName, prefill: { name: buyer.name, email: buyer.email, ...(buyer.phone ? { contact: buyer.phone } : {}) },
      });
      if (!result) { setMessage("You haven't paid yet. Press the button again when you're ready."); return; }
      // The server checks the payment with Razorpay; if this call is lost, it still confirms within a minute.
      await fetch("/api/packages/pay", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: body.token, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }),
      }).catch(() => undefined);
      router.push(`/p/${body.token}`);
    } catch {
      setMessage("Razorpay didn't open, and nothing was charged. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 grid max-w-md gap-4">
      <div><Label htmlFor="name">Your name</Label><Input id="name" name="name" autoComplete="name" required maxLength={100} error={errors.name} /></div>
      <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required error={errors.email} /></div>
      <div><Label htmlFor="phone">WhatsApp number (optional)</Label><Input id="phone" name="phone" type="tel" autoComplete="tel" error={errors.phone} /></div>
      {message && <p className="text-danger" role="alert">{message}</p>}
      <Button type="submit" loading={busy}>{busy ? "Opening payment…" : `Pay ${price}`}</Button>
      <p className="text-sm text-text-muted">Pay by UPI, card or netbanking. Your booking link arrives by email as soon as the payment goes through.</p>
    </form>
  );
}
