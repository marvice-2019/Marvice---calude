import { View } from "react-native";
import { rupees } from "@/shared/format";
import type { Quote } from "@/shared/types";
import { useTheme } from "@/lib/theme";
import { T } from "./ui";

function Row({ k, v, strong, good }: { k: string; v: string; strong?: boolean; good?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <T variant={strong ? "bold" : "body"} style={good ? { color: c.ok } : strong ? { fontSize: 18 } : undefined}>{k}</T>
      <T variant={strong ? "bold" : "body"} style={[{ fontVariant: ["tabular-nums"] }, good ? { color: c.ok } : strong ? { fontSize: 18 } : undefined]}>{v}</T>
    </View>
  );
}

/** Fee and GST always shown as separate lines; the total is the only number the driver pays. */
export function Bill({ q }: { q: Quote }) {
  const c = useTheme();
  return (
    <View accessibilityLabel={`Total ${rupees(q.totalPaise)} including GST ${rupees(q.gstPaise)}`} testID="bill"
      style={{ backgroundColor: c.surface2, borderRadius: 12, padding: 14, gap: 8 }}>
      <Row k={`Parking · ${q.hours} h × ${rupees(q.ratePaise)}`} v={rupees(q.basePaise)} />
      {q.discountPaise > 0 && <Row k={`Promo ${q.promoCode}`} v={`−${rupees(q.discountPaise)}`} good />}
      <Row k="Platform fee" v={rupees(q.feePaise)} />
      <Row k="GST 18%" v={rupees(q.gstPaise)} />
      <View style={{ borderTopWidth: 1, borderStyle: "dashed", borderColor: c.line, paddingTop: 10 }}>
        <Row k="Total" v={rupees(q.totalPaise)} strong />
      </View>
    </View>
  );
}
