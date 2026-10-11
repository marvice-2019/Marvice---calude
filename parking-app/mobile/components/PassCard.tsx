import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { clock, relative, rupees, when } from "@/shared/format";
import type { Booking } from "@/shared/types";
import { font, useTheme } from "@/lib/theme";
import { Button, Code, T } from "./ui";

type Props = { b: Booking; now: number; offline?: boolean; busy?: string; onExtend?: () => void; onCancel?: () => void; onSpot?: () => void };

/** A gate pass: works from local storage alone, so it opens in a basement with no signal. */
export function PassCard({ b, now, offline, busy, onExtend, onCancel, onSpot }: Props) {
  const c = useTheme();
  const start = Date.parse(b.from), end = Date.parse(b.to);
  const live = now >= start && now < end;
  const pct = live ? Math.round(((now - start) / (end - start)) * 100) : 0;
  const cancellable = now < start - 3_600_000;
  const spot = b.spot ? [b.spot.floor && `Floor ${b.spot.floor}`, b.spot.bay && `Bay ${b.spot.bay}`, b.spot.note].filter(Boolean).join(" · ") : "";

  return (
    <View testID={`pass-${b.code}`} accessibilityLabel={`Pass ${b.code} for ${b.lot_name}`} style={{ backgroundColor: c.surface, borderRadius: 18, overflow: "hidden", elevation: 2 }}>
      <View style={{ backgroundColor: c.dusk2, padding: 16, gap: 6 }}>
        <Code>{b.lot_code.replace(/^BLR/, "")}</Code>
        <T variant="title" style={{ color: "#fff" }}>{b.lot_name}</T>
        <T style={{ color: "#D7E0F5", fontSize: 14 }}>{when(b.from)} → {clock(b.to)}</T>
      </View>
      <View style={{ padding: 16, gap: 12, borderTopWidth: 2, borderStyle: "dashed", borderColor: c.line }}>
        <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: live ? c.okSoft : c.surface2 }}>
          <T variant="bold" style={{ fontSize: 13, color: live ? c.ok : c.ink }}>{live ? `Parked · ${relative(end - now)} left` : `Starts ${when(b.from)}`}</T>
        </View>
        <View accessible accessibilityRole="image" accessibilityLabel={`Gate QR for pass ${b.code}`} style={{ alignSelf: "center", padding: 12, backgroundColor: "#fff", borderRadius: 12 }}>
          <QRCode value={b.code} size={176} ecl="M" />
        </View>
        <T style={{ textAlign: "center", fontFamily: font.mono, fontSize: 22, letterSpacing: 3 }}>{b.code}</T>
        {live && (
          <View accessibilityLabel={`${pct}% of your time used`} style={{ height: 8, borderRadius: 99, backgroundColor: c.surface2, overflow: "hidden" }}>
            <View style={{ width: `${pct}%`, height: "100%", backgroundColor: c.ok }} />
          </View>
        )}
        <View style={{ gap: 6 }}>
          <KV k="Vehicle" v={b.plate} mono />
          <KV k="Paid" v={`${rupees(b.total_paise)} (GST ${rupees(b.gst_paise)})`} />
          {!!spot && <KV k="Your spot" v={spot} />}
        </View>
        {offline ? <T variant="muted">Saved pass. Extend and cancel need a connection.</T> : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {live && onExtend && <Button title="+1 hour" onPress={onExtend} busy={busy === "extend"} style={{ flexGrow: 1 }} />}
            {onSpot && <Button kind="ghost" title={b.spot ? "Edit spot" : "Mark my spot"} onPress={onSpot} style={{ flexGrow: 1 }} />}
            {cancellable && onCancel && <Button kind="ghost" title="Cancel" onPress={onCancel} busy={busy === "cancel"} style={{ flexGrow: 1 }} />}
          </View>
        )}
      </View>
    </View>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
      <T variant="muted">{k}</T>
      <T variant={mono ? "mono" : "body"} style={{ flexShrink: 1, textAlign: "right" }}>{v}</T>
    </View>
  );
}
