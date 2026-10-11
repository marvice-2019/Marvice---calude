import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Bill } from "@/components/Bill";
import { SignIn } from "@/components/SignIn";
import { Button, Card, Chip, Field, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { scheduleExpiryReminder } from "@/lib/notify";
import { payHaptic } from "@/lib/feedback";
import { pay } from "@/lib/pay";
import { font, useTheme } from "@/lib/theme";
import { useMe } from "@/lib/useMe";
import { cleanPlate, PLATE, rupees } from "@/shared/format";
import type { CreateBookingResponse, LotSummary, Quote } from "@/shared/types";

const HOURS = [1, 2, 3, 4, 6, 8];
type Lot = Pick<LotSummary, "id" | "name" | "code" | "address" | "status">;

// DRV-09: digits from the entrance board → hours → pay.
export default function ParkNow() {
  const c = useTheme();
  const { me, reload } = useMe();
  const [code, setCode] = useState(""), [lot, setLot] = useState<Lot | null>(null), [hours, setHours] = useState(2), [quote, setQuote] = useState<Quote | null>(null);
  const [plate, setPlate] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const plateValue = plate || me?.vehicles[0]?.plate || "";

  async function quoteFor(id: string, h: number) {
    const from = new Date(Math.floor(Date.now() / 60_000) * 60_000), to = new Date(from.getTime() + h * 3_600_000);
    setQuote(await api<Quote>("/v1/quotes", { method: "POST", body: { lot_id: id, from: from.toISOString(), to: to.toISOString(), vehicle: "car" } }).catch(() => null));
  }
  async function find() {
    setErr(""); setLot(null); setQuote(null);
    if (!/^\d{3,5}$/.test(code)) return setErr("The lot number is 3 to 5 digits, on the board at the entrance.");
    try {
      const r = await api<{ lot: Lot }>(`/v1/lots/by-code/${code}`, { auth: false });
      if (r.lot.status !== "open") return setErr(`${r.lot.name} isn't taking cars right now.`);
      setLot(r.lot); quoteFor(r.lot.id, hours);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't look that up."); }
  }
  async function book() {
    if (!lot) return;
    const p = cleanPlate(plateValue);
    if (!PLATE.test(p)) return setErr("Enter the number plate like KA01AB1234.");
    setErr(""); setBusy(true);
    try {
      const res = await api<CreateBookingResponse>("/v1/bookings", { method: "POST", idempotent: true, body: { lot_id: lot.id, source: "park_now", hours, plate: p } });
      const out = await pay(res.razorpay_order, { contact: me?.user.phone }, `${lot.name} · Park now`);
      payHaptic(out);
      if (out === "paid") { scheduleExpiryReminder({ ...res.booking, lot_name: lot.name }).catch(() => undefined); router.replace({ pathname: "/passes", params: { new: res.booking.id } }); return; }
      setErr(out === "cancelled" ? "Payment closed. Tap Pay to try again." : "The payment didn't go through. No money was taken.");
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Something went wrong."); }
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Type the number on the yellow board at the entrance.</T>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}><Field label="Lot number" value={code} onChangeText={v => setCode(v.replace(/\D/g, "").slice(0, 5))} keyboardType="number-pad" autoFocus
          placeholder="101" style={{ fontFamily: font.mono, fontSize: 28, letterSpacing: 6 }} onSubmitEditing={find} /></View>
        <Button kind="kerb" title="Find" onPress={find} />
      </View>
      {lot && (
        <Card>
          <T variant="title">{lot.name}</T><T variant="muted">{lot.address}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {HOURS.map(h => <Chip key={h} soft label={`${h} h`} on={hours === h} onPress={() => { setHours(h); quoteFor(lot.id, h); }} />)}
          </View>
          {quote && <Bill q={quote} />}
          {me === null ? <SignIn title="Sign in to pay" onDone={reload} /> : (
            <>
              <Field label="Number plate" value={plateValue} onChangeText={v => setPlate(v.toUpperCase())} autoCapitalize="characters" placeholder="KA01AB1234" />
              <Button title={quote ? `Pay ${rupees(quote.totalPaise)}` : "Pay"} onPress={book} busy={busy} disabled={!quote || me === undefined} />
            </>
          )}
        </Card>
      )}
      {!!err && <T accessibilityRole="alert" variant="bold" style={{ color: c.warn }}>{err}</T>}
    </ScrollView>
  );
}
