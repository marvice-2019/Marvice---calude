import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { useTheme } from "@/lib/theme";

/** Placeholder rows shaped like lot cards; pulses only when the system allows motion. */
export function LotSkeleton({ rows = 3 }: { rows?: number }) {
  const c = useTheme();
  const [pulse] = useState(() => new Animated.Value(0.55));
  const [still, setStill] = useState(true);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(r => { if (live) setStill(r); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, pulse]);
  return (
    <View accessibilityLabel="Loading lots" accessibilityRole="progressbar" style={{ gap: 10, paddingHorizontal: 16 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={{ opacity: pulse, flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.surface }}>
          <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: c.surface2 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 14, width: "70%", borderRadius: 6, backgroundColor: c.surface2 }} />
            <View style={{ height: 10, width: "45%", borderRadius: 6, backgroundColor: c.surface2 }} />
            <View style={{ height: 10, width: "35%", borderRadius: 6, backgroundColor: c.surface2 }} />
          </View>
          <View style={{ width: 70, height: 22, borderRadius: 6, backgroundColor: c.surface2 }} />
        </Animated.View>
      ))}
    </View>
  );
}
