import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, View } from "react-native";
import { Checkout } from "@/components/Checkout";
import { Button, Card, Code, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { rupees } from "@/shared/format";
import { nextQuarter } from "@/shared/time";
import type { LotDetailResponse } from "@/shared/types";

export default function LotScreen() {
  const c = useTheme();
  const p = useLocalSearchParams<{ id: string; from?: string; to?: string; vehicle?: string }>();
  const from = p.from ?? nextQuarter().toISOString();
  const to = p.to ?? new Date(Date.parse(from) + 2 * 3_600_000).toISOString();
  const vehicle = p.vehicle ?? "car";
  const [data, setData] = useState<LotDetailResponse | null>(null), [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    api<LotDetailResponse>(`/v1/lots/${p.id}?${new URLSearchParams({ from, to, vehicle })}`, { auth: false })
      .then(d => { if (live) setData(d); }).catch(x => { if (live) setErr(x instanceof ApiFailure ? x.message : "Couldn't load this lot."); });
    return () => { live = false; };
  }, [p.id, from, to, vehicle]);

  if (err) return <View style={{ padding: 16 }}><Card><T variant="bold">{err}</T><Button title="Back to lots" onPress={() => router.back()} /></Card></View>;
  if (!data) return <ActivityIndicator style={{ marginTop: 48 }} color={c.sign} accessibilityLabel="Loading lot" />;
  const { lot, quote, spots_left } = data;
  const hours = lot.open_24h ? "Open 24 hours" : lot.opens_at && lot.closes_at ? `${lot.opens_at.slice(0, 5)}–${lot.closes_at.slice(0, 5)}` : "Hours vary";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: lot.name }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Code>{lot.code.replace(/^BLR/, "")}</Code>
        <T variant="display" style={{ fontSize: 34, lineHeight: 36 }}>{lot.name}</T>
        <T variant="muted">{lot.address}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Fact big={rupees(quote.ratePaise)} small="per hour" />
          <Fact big={String(spots_left)} small="bays free then" />
          <Fact big={lot.covered ? "Covered" : "Open air"} small={hours} />
          <Fact big={lot.ev_chargers ? String(lot.ev_chargers) : "—"} small="EV chargers" />
        </View>
        <Button kind="ghost" title="Directions" onPress={() => Linking.openURL(Platform.OS === "ios" ? `maps://?daddr=${lot.lat},${lot.lng}` : `google.navigation:q=${lot.lat},${lot.lng}`)} />
        <Checkout lotId={lot.id} lotName={lot.name} initialQuote={quote} from={from} to={to} vehicle={vehicle}
          full={spots_left === 0 || lot.status !== "open"} onPaid={id => router.replace({ pathname: "/passes", params: { new: id } })} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ big, small }: { big: string; small: string }) {
  const c = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: "45%", padding: 14, borderRadius: 12, backgroundColor: c.surface }}>
      <T variant="title" style={{ fontVariant: ["tabular-nums"] }}>{big}</T><T variant="small">{small}</T>
    </View>
  );
}
