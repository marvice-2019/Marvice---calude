import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button, Card, Chip, Field, T } from "@/components/ui";
import { api } from "@/lib/api";
import { payHaptic } from "@/lib/feedback";
import { flush, loadQueue, newScan, submit, type SendOutcome } from "@/lib/gateQueue";
import { kv } from "@/lib/kv";
import { font, useTheme } from "@/lib/theme";
import { cleanPlate, clock, PLATE, rupees } from "@/shared/format";
import type { Arrival, OpsLot } from "@/shared/types";

const LOT_KEY = "bl_staff_lot", ARR_KEY = (id: string) => `bl_arrivals_${id}`;
const PASS = /^BL-[A-Z0-9]{4,8}$/;

/** Today's arrivals; the last saved copy when the basement has no signal. */
async function fetchArrivals(id: string): Promise<Arrival[]> {
  try { const a = await api<Arrival[]>(`/v1/ops/lots/${id}/arrivals`); await kv.set(ARR_KEY(id), JSON.stringify(a)); return a; }
  catch { const raw = await kv.get(ARR_KEY(id)); return raw ? JSON.parse(raw) : []; }
}

// Staff mode (OPS-01/02): scan the pass QR or type a plate, check in or out. Works offline; scans queue and send later.
export default function Staff() {
  const c = useTheme();
  const [lots, setLots] = useState<OpsLot[] | null>(null), [lotId, setLotId] = useState(""), [dir, setDir] = useState<"in" | "out">("in");
  const [ref, setRef] = useState(""), [scanning, setScanning] = useState(false), [perm, askPerm] = useCameraPermissions();
  const [last, setLast] = useState<{ outcome: SendOutcome; label: string } | null>(null), [queued, setQueued] = useState(0);
  const [arrivals, setArrivals] = useState<Arrival[]>([]), [busy, setBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    let live = true;
    Promise.all([api<OpsLot[]>("/v1/ops/lots").catch(() => [] as OpsLot[]), kv.get(LOT_KEY)]).then(([l, saved]) => {
      if (!live) return;
      setLots(l); setLotId(saved && l.some(x => x.id === saved) ? saved : l[0]?.id ?? "");
    });
    loadQueue().then(q => { if (live) setQueued(q.length); });
    return () => { live = false; };
  }, []);

  const loadArrivals = useCallback((id: string) => fetchArrivals(id).then(setArrivals), []);
  useEffect(() => {
    if (!lotId) return;
    let live = true;
    kv.set(LOT_KEY, lotId);
    fetchArrivals(lotId).then(a => { if (live) setArrivals(a); });
    return () => { live = false; };
  }, [lotId]);

  // Drain the queue every 15 s while this screen is open.
  useFocusEffect(useCallback(() => {
    const t = setInterval(async () => { const r = await flush(); setQueued(r.queued); }, 15_000);
    return () => clearInterval(t);
  }, []));

  async function record(input: string) {
    if (lock.current || !lotId) return;
    const v = input.trim().toUpperCase();
    const asPlate = cleanPlate(v);
    const r = PASS.test(v) ? { pass_code: v } : PLATE.test(asPlate) ? { plate: asPlate } : null;
    if (!r) { setLast({ outcome: { kind: "rejected", message: "That isn't a Bayline pass code or an Indian number plate." }, label: v }); return; }
    lock.current = true; setBusy(true);
    const scan = newScan(lotId, dir, r);
    const { outcome, queued: q } = await submit(scan);
    setQueued(q); setLast({ outcome, label: r.pass_code ?? r.plate! }); setRef("");
    payHaptic(outcome.kind === "rejected" ? "failed" : "paid");
    if (outcome.kind === "ok") loadArrivals(lotId);
    setBusy(false);
    setTimeout(() => { lock.current = false; }, 1500); // ignore the same QR for a moment after a scan
  }

  if (lots === null) return <View style={{ padding: 16 }}><T variant="muted">Loading your lots…</T></View>;
  if (!lots.length) return <View style={{ padding: 16 }}><Card><T variant="title">No lots on this number</T><T variant="muted">Ask your operator admin to add you as staff.</T></Card></View>;

  const ok = last?.outcome.kind === "ok", res = ok ? (last!.outcome as Extract<SendOutcome, { kind: "ok" }>).result : null;
  const expected = arrivals.filter(a => a.status === "confirmed"), parked = arrivals.filter(a => a.status === "checked_in");

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {lots.map(l => <Chip key={l.id} label={`${l.code.replace(/^BLR/, "")} · ${l.name}`} on={l.id === lotId} onPress={() => setLotId(l.id)} />)}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["in", "out"] as const).map(d => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: dir === d }} onPress={() => setDir(d)}
            style={{ flex: 1, minHeight: 64, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: dir === d ? (d === "in" ? c.ok : c.sign) : c.surface, borderWidth: 1, borderColor: c.line }}>
            <T style={{ fontFamily: font.display, fontSize: 24, color: dir === d ? "#fff" : c.ink }}>{d === "in" ? "Check in" : "Check out"}</T>
          </Pressable>
        ))}
      </View>

      {queued > 0 && (
        <Card style={{ backgroundColor: c.warnSoft }}>
          <T variant="bold" style={{ color: c.warn }}>{queued} scan{queued === 1 ? "" : "s"} waiting for signal</T>
          <T variant="small">They keep their scan time and send by themselves. Let cars through as normal.</T>
          <Button kind="ghost" title="Retry now" onPress={async () => { const r = await flush(); setQueued(r.queued); }} />
        </Card>
      )}

      {scanning ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <CameraView style={{ height: 300 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => { setScanning(false); record(data); }} />
          <Button kind="ghost" title="Close camera" onPress={() => setScanning(false)} style={{ margin: 12 }} />
        </Card>
      ) : (
        <Button kind="kerb" title="Scan pass QR" busy={busy} onPress={async () => {
          if (!perm?.granted) { const p = await askPerm(); if (!p.granted) { setLast({ outcome: { kind: "rejected", message: "Camera is off. Type the pass code or plate below, or allow the camera in Settings." }, label: "" }); return; } }
          setScanning(true);
        }} />
      )}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}><Field label="Or type pass code or plate" value={ref} onChangeText={v => setRef(v.toUpperCase())} autoCapitalize="characters" placeholder="KA01AB1234" onSubmitEditing={() => record(ref)} /></View>
        <Button title={dir === "in" ? "In" : "Out"} onPress={() => record(ref)} busy={busy} />
      </View>

      {last && (
        <Card accessibilityLiveRegion="assertive" style={{ backgroundColor: last.outcome.kind === "rejected" ? c.warnSoft : ok ? c.okSoft : c.tint }}>
          {last.outcome.kind === "rejected" && <><T variant="title" style={{ color: c.warn }}>Stop</T><T variant="bold">{last.outcome.message}</T></>}
          {last.outcome.kind === "offline" && <><T variant="title" style={{ color: c.sign }}>Saved offline</T><T>{last.label} recorded at {clock(new Date())}. It sends when signal returns.</T></>}
          {ok && res && (
            <>
              <T variant="title" style={{ color: c.ok }}>{dir === "in" ? "Checked in" : "Checked out"}</T>
              <T variant="mono">{res.booking?.plate ?? last.label}{res.booking?.code ? ` · ${res.booking.code}` : ""}{res.monthly_pass ? ` · monthly bay ${res.monthly_pass.bay ?? ""}` : ""}</T>
              {res.booking?.ends && <T>Pass ends {clock(res.booking.ends)}</T>}
              {res.overstay && (
                <View style={{ marginTop: 6, padding: 12, borderRadius: 12, backgroundColor: c.kerbSoft }}>
                  <T variant="label">Overstay</T>
                  <T style={{ fontFamily: font.display, fontSize: 34, color: c.ink }}>Collect {rupees(res.overstay.amount_paise)}</T>
                  <T variant="small">{res.overstay.hours} h past the pass, incl. GST. The driver also gets a UPI link on WhatsApp.</T>
                </View>
              )}
              {res.duplicate && <T variant="small">Already recorded earlier.</T>}
            </>
          )}
        </Card>
      )}

      <Card>
        <T variant="title">Expected today ({expected.length})</T>
        {expected.length === 0 && <T variant="muted">No more pre-bookings today.</T>}
        {expected.map(a => (
          <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Check in ${a.plate}`} onPress={() => { setDir("in"); record(a.plate); }}
            style={{ flexDirection: "row", justifyContent: "space-between", minHeight: 48, alignItems: "center", borderTopWidth: 1, borderColor: c.line }}>
            <T variant="mono">{a.plate}</T><T variant="small">{clock(a.from)}–{clock(a.to)}</T>
          </Pressable>
        ))}
        <T variant="label" style={{ marginTop: 8 }}>Parked now ({parked.length})</T>
        {parked.map(a => <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between", minHeight: 40, alignItems: "center" }}><T variant="mono">{a.plate}</T><T variant="small">until {clock(a.to)}</T></View>)}
      </Card>
    </ScrollView>
  );
}
