import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { PassCard } from "@/components/PassCard";
import { SignIn } from "@/components/SignIn";
import { Button, Card, Field, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { cancelExpiryReminder, scheduleExpiryReminder } from "@/lib/notify";
import { LIVE, loadPasses, type PassesResult } from "@/lib/passes";
import { pay } from "@/lib/pay";
import { useTheme } from "@/lib/theme";
import { useNow } from "@/lib/useNow";
import { clock, relative, rupees, when } from "@/shared/format";
import type { Booking, RazorpayOrder } from "@/shared/types";

export default function Passes() {
  const c = useTheme();
  const { new: fresh } = useLocalSearchParams<{ new?: string }>();
  const [state, setState] = useState<PassesResult | null>(null), [signin, setSignin] = useState(false), [err, setErr] = useState("");
  const [waiting, setWaiting] = useState(false), [busy, setBusy] = useState(""), [spotFor, setSpotFor] = useState<Booking | null>(null);
  const now = useNow();
  const polling = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await loadPasses();
      setState(r); setSignin(false); setErr("");
      if (r.source === "network") for (const b of r.bookings) if (LIVE.includes(b.status)) scheduleExpiryReminder(b).catch(() => undefined);
      return r;
    } catch (x) {
      if (x instanceof ApiFailure && x.status === 401) setSignin(true); else setErr("No connection and no saved passes on this phone yet.");
      return null;
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // After checkout the API webhook issues the pass; poll until it appears (late webhooks are normal).
  useEffect(() => {
    if (!fresh || polling.current) return;
    polling.current = true; setWaiting(true);
    let n = 0, stop = false;
    const tick = async () => {
      const r = await load();
      if (stop) return;
      if (r?.bookings.some(b => b.id === fresh && LIVE.includes(b.status))) { setWaiting(false); polling.current = false; return; }
      if (++n < 20) setTimeout(tick, 1500); else { setWaiting(false); polling.current = false; }
    };
    tick();
    return () => { stop = true; };
  }, [fresh, load]);

  async function extend(b: Booking) {
    setBusy(b.id + "extend");
    try {
      const r = await api<{ new_end: string; razorpay_order: RazorpayOrder }>(`/v1/bookings/${b.id}/extend`, { method: "POST", idempotent: true });
      const out = await pay(r.razorpay_order, { contact: b.phone }, `Extend ${b.code}`);
      if (out === "paid") { Alert.alert("Extended", `Now until ${clock(r.new_end)}.`); setTimeout(load, 1500); }
      else Alert.alert("Not extended", "The payment didn't complete. Your pass is unchanged.");
    } catch (x) { Alert.alert("Couldn't extend", x instanceof ApiFailure ? x.message : "Try again."); }
    setBusy("");
  }
  function cancel(b: Booking) {
    Alert.alert(`Cancel ${b.code}?`, `You get a full refund of ${rupees(b.total_paise)}.`, [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel booking", style: "destructive", onPress: async () => {
        setBusy(b.id + "cancel");
        try {
          const r = await api<{ refund: { message: string } }>(`/v1/bookings/${b.id}/cancel`, { method: "POST", idempotent: true });
          await cancelExpiryReminder(b.id); Alert.alert("Cancelled", r.refund.message); load();
        } catch (x) { Alert.alert("Couldn't cancel", x instanceof ApiFailure ? x.message : "Try again."); }
        setBusy("");
      } }
    ]);
  }

  if (signin) return <ScrollView contentContainerStyle={{ padding: 16 }}><SignIn title="Sign in to see your passes" onDone={load} /></ScrollView>;
  const offline = state?.source === "cache";
  const upcoming = (state?.bookings ?? []).filter(b => LIVE.includes(b.status) && Date.parse(b.to) > now);
  const past = (state?.bookings ?? []).filter(b => !upcoming.includes(b)).slice(0, 15);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.sign} />}>
      {offline && <Card style={{ backgroundColor: c.warnSoft }}><T variant="bold" style={{ color: c.warn }}>No signal. Showing passes saved {relative(now - (state?.savedAt ?? now))} ago.</T></Card>}
      {waiting && <Card><T variant="bold" style={{ color: c.ok }}>Confirming payment…</T><T variant="muted">This usually takes a few seconds.</T></Card>}
      {!!err && <Card><T variant="bold">{err}</T><Button title="Try again" onPress={load} /></Card>}
      {state && upcoming.length === 0 && !waiting && <Card><T variant="title">No upcoming passes</T><T variant="muted">Book a bay and your pass appears here, ready for the gate, even offline.</T></Card>}
      {upcoming.map(b => (
        <PassCard key={b.id} b={b} now={now} offline={offline} busy={busy.startsWith(b.id) ? busy.slice(b.id.length) : undefined}
          onExtend={() => extend(b)} onCancel={() => cancel(b)} onSpot={() => setSpotFor(b)} />
      ))}
      {spotFor && <SpotForm b={spotFor} onDone={() => { setSpotFor(null); load(); }} />}
      {past.length > 0 && (
        <Card>
          <T variant="title">Past and cancelled</T>
          {past.map(b => (
            <View key={b.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTopWidth: 1, borderColor: c.line }}>
              <View style={{ flexShrink: 1 }}><T variant="bold">{b.lot_name}</T><T variant="small">{when(b.from)} · {b.code} · {b.status.replace("_", " ")}</T></View>
              <T>{rupees(b.total_paise)}</T>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function SpotForm({ b, onDone }: { b: Booking; onDone: () => void }) {
  const [floor, setFloor] = useState(b.spot?.floor ?? ""), [bay, setBay] = useState(b.spot?.bay ?? ""), [note, setNote] = useState(b.spot?.note ?? ""), [err, setErr] = useState("");
  async function save() {
    try { await api(`/v1/bookings/${b.id}/spot`, { method: "POST", body: { floor, bay, note } }); onDone(); }
    catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't save."); }
  }
  return (
    <Card>
      <T variant="title">Mark my spot · {b.code}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Field label="Floor" value={floor} onChangeText={setFloor} maxLength={6} placeholder="B2" /></View>
        <View style={{ flex: 1 }}><Field label="Bay" value={bay} onChangeText={setBay} maxLength={8} placeholder="47" /></View>
      </View>
      <Field label="Note" value={note} onChangeText={setNote} maxLength={80} placeholder="Near lift C, blue pillar" error={err} />
      <Button title="Save spot" onPress={save} />
      <Button kind="ghost" title="Close" onPress={onDone} />
    </Card>
  );
}
