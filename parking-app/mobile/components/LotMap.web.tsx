import { Linking, Pressable, View } from "react-native";
import type { SearchRow } from "@/shared/types";
import { useTheme } from "@/lib/theme";
import { T } from "./ui";

// react-native-maps has no web renderer; the web preview shows a link to Google Maps instead.
export function LotMap({ rows, center }: { rows: SearchRow[]; center: { lat: number; lng: number }; onPick: (id: string) => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://www.google.com/maps/search/parking/@${center.lat},${center.lng},15z`)}>
      <View style={{ height: 140, borderRadius: 18, backgroundColor: c.tint, alignItems: "center", justifyContent: "center", gap: 4 }}>
        <T variant="bold" style={{ color: c.sign }}>{rows.length} lots on the map</T>
        <T variant="small">Open in Google Maps</T>
      </View>
    </Pressable>
  );
}
