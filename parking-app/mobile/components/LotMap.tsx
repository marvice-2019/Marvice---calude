import MapView, { Marker } from "react-native-maps";
import { rupees } from "@/shared/format";
import type { SearchRow } from "@/shared/types";
import { useTheme } from "@/lib/theme";

// Real map tiles: Apple Maps on iOS, Google Maps on Android (GOOGLE_MAPS_ANDROID_KEY at build time).
export function LotMap({ rows, center, onPick }: { rows: SearchRow[]; center: { lat: number; lng: number }; onPick: (id: string) => void }) {
  const c = useTheme();
  return (
    <MapView style={{ height: 260, borderRadius: 18 }} accessibilityLabel="Map of nearby lots"
      region={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }} showsUserLocation={false}>
      {rows.filter(r => r.lot.lat != null).map(r => (
        <Marker key={r.lot.id} coordinate={{ latitude: r.lot.lat ?? center.lat, longitude: r.lot.lng ?? center.lng }}
          title={r.lot.name} description={`${rupees(r.quote.totalPaise)} incl. GST`} pinColor={c.sign} onCalloutPress={() => onPick(r.lot.id)} />
      ))}
    </MapView>
  );
}
