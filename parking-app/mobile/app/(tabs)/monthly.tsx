import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SignIn } from "@/components/SignIn";
import { Button, Card, Chip, Field, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useMe } from "@/lib/useMe";
import { cleanPlate, km, PLATE } from "@/shared/format";
import { nextQuarter } from "@/shared/time";
import type { SearchRow } from "@/shared/types";

const AREAS = [{ name: "MG Road", lat: 12.9756, lng: 77.6066 }, { name: "Koramangala", lat: 12.9352, lng: 77.6245 }, { name: "Indiranagar", lat: 12.9784, lng: 77.6408 }, { name: "Whitefield", lat: 12.9698, lng: 77.75 }];
const firstOfNextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };

export default function Monthly() {
  const c = useTheme();
  const { me, reload } = useMe();
  const [area, setArea] = useState(AREAS[0]), [lots, setLots] = useState<SearchRow[] | null>(null), [lotId, setLotId] = useState("");
  const [plate, setPlate] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState(""), [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const from = nextQuarter();
    const q = new URLSearchParams({ from: from.toISOString(), to: new Date(from.getTime() + 8 * 3_600_000).toISOString(), vehicle: "car", lat: String(area.lat), lng: String(area.lng) });
    api<SearchRow[]>(`/v1/lots/search?${q}`, { auth: false }).then(r => { if (live) setLots(r); }).catch(() => { if (live) setLots([]); });
    return () => { live = false; };
  }, [area]);

  async function submit() {
    setErr("");
    if (!lotId) return setErr("Pick a lot.");
    setBusy(true);
    try {
      let vehicleId = me?.vehicles[0]?.id;
      const p = cleanPlate(plate || me?.vehicles[0]?.plate || "");
      if (!vehicleId || (plate && p !== me?.vehicles[0]?.plate)) {
        if (!PLATE.test(p)) { setBusy(false); return setErr("Enter the number plate like KA01AB1234."); }
        vehicleId = (await api<{ vehicle: { id: string } }>("/v1/me/vehicles", { method: "POST", body: { plate: p, kind: "car" } })).vehicle.id;
      }
      setDone((await api<{ message: string }>("/v1/monthly-passes", { method: "POST", body: { lot_id: lotId, vehicle_id: vehicleId, starts_on: firstOfNextMonth() } })).message);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Couldn't send the request."); }
    setBusy(false);
  }

  if (me === null) return <ScrollView contentContainerStyle={{ padding: 16 }}><SignIn title="Sign in to request a monthly bay" onDone={reload} /></ScrollView>;
  if (done) return <View style={{ padding: 16 }}><Card><T variant="title">Request sent</T><T variant="muted">{done} We&apos;ll send a payment link when it&apos;s approved.</T></Card></View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <T variant="muted">One bay, every working day. Billed on the 1st, due by the 5th; gate entry pauses after the 7th if unpaid.</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {AREAS.map(a => <Chip key={a.name} label={a.name} on={area.name === a.name} onPress={() => { setArea(a); setLots(null); setLotId(""); }} />)}
      </ScrollView>
      <Card>
        <T variant="label">Lot</T>
        {lots?.length === 0 && <T variant="muted">No lots with monthly bays here yet.</T>}
        {lots?.map(r => (
          <Pressable key={r.lot.id} accessibilityRole="radio" accessibilityState={{ checked: lotId === r.lot.id }} onPress={() => setLotId(r.lot.id)}
            style={{ minHeight: 52, padding: 12, borderRadius: 12, borderWidth: lotId === r.lot.id ? 2 : 1, borderColor: lotId === r.lot.id ? c.sign : c.line, backgroundColor: lotId === r.lot.id ? c.tint : c.surface }}>
            <T variant="bold">{r.lot.name}</T><T variant="small">{km(r.distance_m)}{r.lot.covered ? " · covered" : ""}</T>
          </Pressable>
        ))}
        <Field label="Number plate" value={plate || me?.vehicles[0]?.plate || ""} onChangeText={v => setPlate(v.toUpperCase())} autoCapitalize="characters" placeholder="KA01AB1234" error={err} />
        <Button title="Request a monthly bay" onPress={submit} busy={busy} disabled={me === undefined} />
        <T variant="small">Nothing is charged now. The monthly price with GST comes with the approval.</T>
      </Card>
    </ScrollView>
  );
}
