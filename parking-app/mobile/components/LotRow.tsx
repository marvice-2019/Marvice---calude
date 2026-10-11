import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { km, rupees } from "@/shared/format";
import type { SearchRow } from "@/shared/types";
import { useTheme } from "@/lib/theme";
import { Code, PSign, T } from "./ui";

export function LotRow({ row, query }: { row: SearchRow; query: Record<string, string> }) {
  const c = useTheme();
  const { lot, quote, spots_left } = row;
  const low = spots_left <= 5, full = spots_left === 0;
  const tags = [lot.covered && "Covered", lot.ev_chargers > 0 && "EV", lot.valet && "Valet", lot.open_24h && "24 h"].filter(Boolean) as string[];
  return (
    <Pressable onPress={() => router.push({ pathname: "/lot/[id]", params: { id: lot.id, ...query } })} accessibilityRole="button" accessibilityLabel={`${lot.name}, ${km(row.distance_m)} away, ${rupees(quote.totalPaise)} total, ${spots_left} bays free`}
        style={({ pressed }) => ({ flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.surface, opacity: pressed ? 0.9 : 1, elevation: 1 })}>
        <PSign size={46} />
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="bold">{lot.name}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <T variant="small">{km(row.distance_m)}</T><Code>{lot.code.replace(/^BLR/, "")}</Code>
          </View>
          {tags.length > 0 && <T variant="small">{tags.join(" · ")}</T>}
          <T variant="bold" style={{ fontSize: 13, color: low ? c.warn : c.ok }}>{full ? "Full for these times" : low ? `Only ${spots_left} left` : `${spots_left} bays free`}</T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T variant="title" style={{ fontVariant: ["tabular-nums"] }}>{rupees(quote.totalPaise)}</T>
          <T variant="small">{quote.hours} h · incl. GST</T>
        </View>
    </Pressable>
  );
}
