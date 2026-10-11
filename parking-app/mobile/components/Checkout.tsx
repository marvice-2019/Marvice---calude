import { useState } from "react";
import { View } from "react-native";
import { api, ApiFailure } from "@/lib/api";
import { scheduleExpiryReminder } from "@/lib/notify";
import { payHaptic } from "@/lib/feedback";
import { pay } from "@/lib/pay";
import { useTheme } from "@/lib/theme";
import { useMe } from "@/lib/useMe";
import { cleanPlate, PLATE, rupees, when } from "@/shared/format";
import type { ApiError, CreateBookingResponse, Quote } from "@/shared/types";
import { Bill } from "./Bill";
import { SignIn } from "./SignIn";
import { Button, Card, Chip, Field, T } from "./ui";

const METHODS = [{ id: "upi", label: "UPI" }, { id: "card", label: "Card" }, { id: "netbanking", label: "Netbanking" }];

type Props = {
  lotId: string; lotName: string; initialQuote: Quote; from: string; to: string; vehicle: string; full: boolean;
  onPaid: (bookingId: string) => void;
};

export function Checkout({ lotId, lotName, initialQuote, from, to, vehicle, full, onPaid }: Props) {
  const c = useTheme();
  const { me, reload } = useMe();
  const [quote, setQuote] = useState(initialQuote);
  const [promo, setPromo] = useState(""), [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [plate, setPlate] = useState(""), [method, setMethod] = useState("upi");
  const [err, setErr] = useState(""), [alts, setAlts] = useState<ApiError["alternatives"]>([]);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<CreateBookingResponse | null>(null);
  const plateValue = plate || me?.vehicles[0]?.plate || "";

  async function applyPromo() {
    if (!promo.trim()) return;
    setPromoMsg(null);
    try {
      const q = await api<Quote>("/v1/quotes", { method: "POST", body: { lot_id: lotId, from, to, vehicle, promo: promo.trim().toUpperCase() } });
      setQuote(q);
      setPromoMsg(q.promo_error ? { ok: false, text: q.promo_error } : { ok: true, text: `Applied. You save ${rupees(q.discountPaise)}.` });
    } catch (x) { setPromoMsg({ ok: false, text: x instanceof ApiFailure ? x.message : "Couldn't check that code." }); }
  }

  async function collect(res: CreateBookingResponse) {
    const out = await pay(res.razorpay_order, { contact: me?.user.phone, method }, `${lotName} · ${res.booking.code}`);
    payHaptic(out);
    if (out === "paid") { scheduleExpiryReminder({ ...res.booking, lot_name: lotName }).catch(() => undefined); onPaid(res.booking.id); return; }
    setBusy(false);
    setErr(out === "cancelled" ? "Payment closed. Your bay is held for 10 minutes; tap Pay to try again." : "The payment didn't go through. No money was taken. Try again or pick another method.");
  }

  async function submit() {
    setErr(""); setAlts([]);
    const p = cleanPlate(plateValue);
    if (!PLATE.test(p)) return setErr("Enter the number plate like KA01AB1234.");
    setBusy(true);
    if (pending) return collect(pending); // retry on the same held bay, never a second booking
    try {
      const res = await api<CreateBookingResponse>("/v1/bookings", { method: "POST", idempotent: true,
        body: { lot_id: lotId, from, to, vehicle_kind: vehicle, plate: p, promo: quote.promoCode ?? undefined } });
      setPending(res);
      await collect(res);
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiFailure) { setErr(x.message); setAlts(x.body.alternatives ?? []); } else setErr("Something went wrong. Try again in a minute.");
    }
  }

  if (me === null) return <View style={{ gap: 12 }}><Bill q={quote} /><SignIn title="Sign in to book" onDone={reload} /></View>;

  return (
    <Card>
      <T variant="label">Your booking</T>
      <T variant="bold">{when(from)} → {when(to)}</T>
      <Bill q={quote} />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}><Field label="Promo code" value={promo} onChangeText={v => setPromo(v.toUpperCase())} autoCapitalize="characters" placeholder="FIRST50" maxLength={20} /></View>
        <Button kind="ghost" title="Apply" onPress={applyPromo} />
      </View>
      {promoMsg && <T accessibilityRole="alert" testID="promo-msg" style={{ color: promoMsg.ok ? c.ok : c.warn, fontSize: 14 }}>{promoMsg.text}</T>}
      <Field label="Number plate" value={plateValue} onChangeText={v => setPlate(v.toUpperCase())} autoCapitalize="characters" placeholder="KA01AB1234" maxLength={13} />
      <T variant="label">Pay with</T>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {METHODS.map(m => <Chip key={m.id} soft label={m.label} on={method === m.id} onPress={() => setMethod(m.id)} />)}
      </View>
      {!!err && <T accessibilityRole="alert" testID="checkout-error" style={{ color: c.warn, fontSize: 14 }}>{err}</T>}
      {alts?.map(a => <T key={a.id} variant="muted">Nearby with space: {a.name}</T>)}
      <Button title={full ? "Full for these times" : `Pay ${rupees(quote.totalPaise)}`} onPress={submit} busy={busy} disabled={full || me === undefined} />
      <T variant="small">GST invoice on WhatsApp. Free cancellation up to 1 hour before arrival.</T>
    </Card>
  );
}
