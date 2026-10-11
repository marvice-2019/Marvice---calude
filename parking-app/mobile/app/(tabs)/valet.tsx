import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SignIn } from "@/components/SignIn";
import { Button, Card, Chip, Field, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { pay } from "@/lib/pay";
import { useTheme } from "@/lib/theme";
import { useNow } from "@/lib/useNow";
import { clock, km, relative, rupees } from "@/shared/format";
import type { ValetDesk, ValetRequestResponse, ValetTicket } from "@/shared/types";

const STEPS: [ValetTicket["status"], string][] = [["dropped", "Keys handed over"], ["parked", "Parked"], ["requested", "Requested"], ["coming", "On the way"], ["ready", "At the porch"]];
const TIPS = [0, 2000, 5000, 10000];

export default function Valet() {
  const c = useTheme();
  const [tickets, setTickets] = useState<ValetTicket[] | null>(null), [signin, setSignin] = useState(false), [desks, setDesks] = useState<ValetDesk[]>([]);
  const load = useCallback(async () => {
    try { setTickets(await api<ValetTicket[]>("/v1/valet/tickets")); setSignin(false); }
    catch (x) { if (x instanceof ApiFailure && x.status === 401) setSignin(true); }
  }, []);
  useFocusEffect(useCallback(() => { load(); api<ValetDesk[]>("/v1/valet/desks?lat=12.9716&lng=77.5946", { auth: false }).then(setDesks).catch(() => undefined); }, [load]));
  const moving = tickets?.some(t => t.status === "requested" || t.status === "coming");
  useEffect(() => { if (!moving) return; const t = setInterval(load, 8000); return () => clearInterval(t); }, [moving, load]);
  const open = tickets?.filter(t => t.status !== "closed" && t.status !== "cancelled") ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      {signin && <SignIn title="Sign in with the number you gave the valet" onDone={load} />}
      {tickets && open.length === 0 && <Card><T variant="title">No car with a valet right now</T><T variant="muted">Hand over your keys at a Bayline desk and your ticket appears here.</T></Card>}
      {open.map(t => <Ticket key={t.id} t={t} onChange={load} />)}
      <Card>
        <T variant="title">Valet desks nearby</T>
        {desks.map(d => (
          <View key={d.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: c.line }}>
            <View style={{ flexShrink: 1 }}><T variant="bold">{d.name}</T><T variant="small">{km(d.distance_m)} · about {d.typical_eta_min} min{d.validator ? ` · free with ${d.validator}` : ""}</T></View>
            <T>{rupees(d.fee_paise + d.gst_paise)}</T>
          </View>
        ))}
        <T variant="small">Fees include 18% GST. Tips go to the valet team in full and aren&apos;t taxed or invoiced.</T>
      </Card>
    </ScrollView>
  );
}

function Ticket({ t, onChange }: { t: ValetTicket; onChange: () => void }) {
  const c = useTheme(), now = useNow(5000);
  const [tip, setTip] = useState(2000), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const idx = STEPS.findIndex(s => s[0] === t.status);
  const canRequest = t.status === "dropped" || t.status === "parked";
  async function request() {
    setBusy(true); setErr("");
    try {
      const r = await api<ValetRequestResponse>(`/v1/valet/tickets/${t.id}/request`, { method: "POST", idempotent: true, body: { tip_paise: tip, validation_code: code.trim() || undefined } });
      if (r.razorpay_order && (await pay(r.razorpay_order, { contact: t.phone }, `Valet ${t.code}`)) !== "paid") setErr("Payment didn't complete. Your car is still requested; pay at the desk if you prefer.");
      onChange();
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't request your car."); }
    setBusy(false);
  }
  return (
    <Card>
      <T variant="label">{t.code} · key tag {t.key_tag}</T>
      <T variant="title">{t.desk_name}</T>
      {(t.status === "requested" || t.status === "coming") && (
        <T variant="display" accessibilityLiveRegion="polite" style={{ color: c.sign }}>{t.eta_at && now ? relative(Date.parse(t.eta_at) - now) : `${t.typical_eta_min} min`}</T>
      )}
      {STEPS.map(([s, label], i) => (
        <View key={s} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < idx ? c.ok : i === idx ? c.kerb : c.line }} />
          <T variant={i === idx ? "bold" : "body"} style={{ color: i <= idx ? c.ink : c.muted }}>{label}{s === "dropped" ? ` · ${clock(t.dropped_at)}` : s === "parked" && t.bay ? ` · bay ${t.bay}` : ""}</T>
        </View>
      ))}
      {canRequest && (
        <>
          <T variant="label">Tip the valet team</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TIPS.map(v => <Chip key={v} soft label={v ? rupees(v) : "No tip"} on={tip === v} onPress={() => setTip(v)} />)}</View>
          <Field label="Validation code (optional)" value={code} onChangeText={v => setCode(v.toUpperCase())} autoCapitalize="characters" maxLength={12} error={err} />
          <Button kind="kerb" title="Bring my car" onPress={request} busy={busy} />
        </>
      )}
    </Card>
  );
}
