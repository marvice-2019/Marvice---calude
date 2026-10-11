import * as Location from "expo-location";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LotMap } from "@/components/LotMap";
import { LotRow } from "@/components/LotRow";
import { LotSkeleton } from "@/components/Skeleton";
import { Button, Card, Chip, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { font, useTheme } from "@/lib/theme";
import { greeting, when } from "@/shared/format";
import { ARRIVALS, DURATIONS } from "@/shared/time";
import type { Destination, SearchRow } from "@/shared/types";

const MG_ROAD: Destination = { name: "MG Road", kind: "area", lat: 12.9756, lng: 77.6066 };

export default function Find() {
  const c = useTheme(), inset = useSafeAreaInsets();
  const [dest, setDest] = useState<Destination>(MG_ROAD), [text, setText] = useState(MG_ROAD.name), [sugg, setSugg] = useState<Destination[]>([]);
  const [arrival, setArrival] = useState("now"), [hours, setHours] = useState(2), [view, setView] = useState<"list" | "map">("list");
  const [res, setRes] = useState<{ key: string; rows: SearchRow[] | null; err: string } | null>(null), [nonce, setNonce] = useState(0);
  const [locErr, setLocErr] = useState(""), [locating, setLocating] = useState(false);

  const from = useMemo(() => (ARRIVALS.find(a => a.id === arrival) ?? ARRIVALS[0]).at(), [arrival]);
  const query = useMemo(() => ({ from: from.toISOString(), to: new Date(from.getTime() + hours * 3_600_000).toISOString(), vehicle: "car" }), [from, hours]);
  const key = `${dest.lat},${dest.lng}|${query.from}|${query.to}|${nonce}`;

  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ ...query, lat: String(dest.lat), lng: String(dest.lng) });
    api<SearchRow[]>(`/v1/lots/search?${p}`, { auth: false })
      .then(rows => { if (live) setRes({ key, rows, err: "" }); })
      .catch(x => { if (live) setRes({ key, rows: null, err: x instanceof ApiFailure ? x.message : "Couldn't load lots." }); });
    return () => { live = false; };
  }, [key, query, dest]);

  const typed = text.trim() && text.trim() !== dest.name ? text.trim() : "";
  useEffect(() => {
    if (!typed) return;
    let live = true;
    const t = setTimeout(() => api<Destination[]>(`/v1/destinations?q=${encodeURIComponent(typed)}`, { auth: false }).then(d => { if (live) setSugg(d); }).catch(() => undefined), 160);
    return () => { live = false; clearTimeout(t); };
  }, [typed]);

  // Location is asked for only here, after the tap, with the reason shown in the system prompt (app.config.ts).
  async function nearMe() {
    setLocErr(""); setLocating(true);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) { setLocErr("Location is off. Type an area instead, or allow location in Settings."); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { name: "You", kind: "area", lat: p.coords.latitude, lng: p.coords.longitude };
      setDest(here); setText("Near me");
    } catch { setLocErr("Couldn't find you. Type an area instead."); }
    finally { setLocating(false); }
  }

  const loading = res?.key !== key, rows = loading ? null : res?.rows ?? null, err = loading ? "" : res?.err ?? "";

  const header = (
    <View>
      <View style={{ backgroundColor: c.dusk1, paddingTop: inset.top + 20, paddingHorizontal: 16, paddingBottom: 72, overflow: "hidden" }}>
        <View style={{ position: "absolute", right: -80, top: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: c.dusk3, opacity: 0.55 }} />
        <View style={{ position: "absolute", left: -40, bottom: 26, width: 180, height: 2, backgroundColor: c.kerb, opacity: 0.5 }} />
        <T variant="label" style={{ color: "#C9D6F5" }}>{greeting()} · Bengaluru</T>
        <T style={{ fontFamily: font.display, fontSize: 44, lineHeight: 46, color: "#fff", marginTop: 8 }}>
          Your bay is <T style={{ fontFamily: font.display, fontSize: 44, color: c.kerb }}>waiting.</T>
        </T>
        <T style={{ color: "#D7E0F5", marginTop: 8 }}>Full price with GST before you leave. Drive straight in.</T>
      </View>
      <Card style={{ marginHorizontal: 16, marginTop: -52 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput accessibilityLabel="Where are you going?" value={text} onChangeText={setText} placeholder="Area, mall, stadium…" placeholderTextColor={c.muted}
            style={{ flex: 1, minWidth: 0, minHeight: 50, borderRadius: 12, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, fontSize: 18, fontFamily: font.bodyBold, color: c.ink }} />
          <Button kind="ghost" title={locating ? "…" : "Near me"} onPress={nearMe} style={{ paddingHorizontal: 12, flexShrink: 0 }} />
        </View>
        {!!locErr && <T accessibilityRole="alert" style={{ color: c.warn }}>{locErr}</T>}
        {!!typed && sugg.length > 0 && (
          <View accessibilityRole="list" style={{ gap: 2 }}>
            {sugg.map(s => (
              <Pressable key={s.name} accessibilityRole="button" onPress={() => { setDest(s); setText(s.name); setSugg([]); }}
                style={{ minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 8, borderRadius: 8 }}>
                <T>{s.name}</T><T variant="small">{s.kind}</T>
              </Pressable>
            ))}
          </View>
        )}
        <T variant="label">Arriving</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {ARRIVALS.map(a => <Chip key={a.id} label={a.label} on={arrival === a.id} onPress={() => setArrival(a.id)} />)}
        </ScrollView>
        <T variant="label">For</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {DURATIONS.map(h => <Chip key={h} soft label={h === 24 ? "All day" : `${h} h`} on={hours === h} onPress={() => setHours(h)} />)}
        </ScrollView>
        <T variant="small">{when(query.from)} → {when(query.to)}</T>
      </Card>
      <Pressable accessibilityRole="button" onPress={() => router.push("/park-now")}
        style={{ margin: 16, marginBottom: 0, padding: 14, borderRadius: 18, backgroundColor: c.kerbSoft, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.kerb, alignItems: "center", justifyContent: "center" }}>
          <T style={{ fontFamily: font.display, fontSize: 26, color: c.onKerb }}>P</T>
        </View>
        <View style={{ flex: 1 }}><T variant="bold">Already at the gate?</T><T variant="small">Type the number on the board. Pay in under a minute.</T></View>
        <T variant="bold" style={{ color: c.sign }}>Park now ›</T>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 22, paddingBottom: 10 }}>
        <T variant="title">{dest.name === "You" ? "Near you" : `Near ${dest.name}`}</T>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Chip label="List" on={view === "list"} onPress={() => setView("list")} />
          <Chip label="Map" on={view === "map"} onPress={() => setView("map")} />
        </View>
      </View>
      {view === "map" && rows && <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><LotMap rows={rows} center={dest} onPick={id => router.push({ pathname: "/lot/[id]", params: { id, ...query } })} /></View>}
      {loading && <LotSkeleton />}
      {!!err && <Card style={{ margin: 16 }}><T variant="bold">Couldn&apos;t load lots</T><T variant="muted">{err}</T><Button title="Try again" onPress={() => setNonce(n => n + 1)} /></Card>}
      {rows?.length === 0 && <Card style={{ margin: 16 }}><T variant="bold">No bays here for those times</T><T variant="muted">Try a shorter stay or a nearby area.</T></Card>}
    </View>
  );

  return (
    <FlatList style={{ backgroundColor: c.bg }} data={rows ?? []} keyExtractor={r => r.lot.id} ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: 32 }} ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      renderItem={({ item }) => <View style={{ paddingHorizontal: 16 }}><LotRow row={item} query={query} /></View>}
      keyboardShouldPersistTaps="handled" />
  );
}
