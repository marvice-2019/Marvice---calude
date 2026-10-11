import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type TextProps, type ViewProps } from "react-native";
import { font, radius, useTheme } from "@/lib/theme";

// Small set of primitives so every screen uses the same tokens; no screen hard-codes a colour.

export function T({ style, variant = "body", ...p }: TextProps & { variant?: "body" | "bold" | "muted" | "display" | "title" | "label" | "mono" | "small" }) {
  const c = useTheme();
  const v = {
    body: { fontFamily: font.body, fontSize: 16, color: c.ink, lineHeight: 23 },
    bold: { fontFamily: font.bodyBold, fontSize: 16, color: c.ink },
    muted: { fontFamily: font.body, fontSize: 14, color: c.muted, lineHeight: 20 },
    small: { fontFamily: font.body, fontSize: 13, color: c.muted },
    display: { fontFamily: font.display, fontSize: 40, color: c.ink, lineHeight: 42, letterSpacing: -0.5 },
    title: { fontFamily: font.displaySemi, fontSize: 24, color: c.ink, lineHeight: 28 },
    label: { fontFamily: font.bodyBold, fontSize: 12, color: c.muted, letterSpacing: 1, textTransform: "uppercase" as const },
    mono: { fontFamily: font.mono, fontSize: 15, color: c.ink, letterSpacing: 0.5 }
  }[variant];
  return <Text {...p} style={[v, style]} />;
}

export function Card({ style, ...p }: ViewProps) {
  const c = useTheme();
  return <View {...p} style={[{ backgroundColor: c.surface, borderRadius: radius.l, padding: 16, gap: 12, shadowColor: "#0E1A33", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 }, style]} />;
}

export function Button({ title, kind = "primary", busy, disabled, style, ...p }: PressableProps & { title: string; kind?: "primary" | "ghost" | "kerb"; busy?: boolean }) {
  const c = useTheme();
  const bg = kind === "primary" ? c.sign : kind === "kerb" ? c.kerb : c.surface;
  const fg = kind === "primary" ? c.onSign : kind === "kerb" ? c.onKerb : c.ink;
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} {...p}
      style={state => [{ minHeight: 52, borderRadius: radius.m, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
        backgroundColor: bg, opacity: off ? 0.55 : state.pressed ? 0.88 : 1, borderWidth: kind === "ghost" ? 1 : 0, borderColor: c.line,
        transform: [{ scale: state.pressed ? 0.98 : 1 }] }, typeof style === "function" ? style(state) : style]}>
      {busy && <ActivityIndicator color={fg} />}
      <Text style={{ color: fg, fontFamily: font.bodyBold, fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, soft }: { label: string; on: boolean; onPress: () => void; soft?: boolean }) {
  const c = useTheme();
  const active = soft ? c.sign : c.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} hitSlop={4}
      style={{ minHeight: 44, paddingHorizontal: 15, justifyContent: "center", borderRadius: 999, borderWidth: 1,
        borderColor: on ? active : c.line, backgroundColor: on ? active : c.surface }}>
      <Text style={{ fontFamily: font.bodyBold, fontSize: 14, color: on ? (soft ? c.onSign : c.surface) : c.ink }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, error, ...p }: TextInputProps & { label: string; error?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T variant="label">{label}</T>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...p}
        style={[{ minHeight: 50, borderRadius: radius.m, borderWidth: 1, borderColor: error ? c.warn : c.line, backgroundColor: c.surface2,
          paddingHorizontal: 14, fontSize: 17, color: c.ink, fontFamily: font.body }, p.style]} />
      {!!error && <T accessibilityRole="alert" style={{ color: c.warn, fontFamily: font.bodyBold, fontSize: 14 }}>{error}</T>}
    </View>
  );
}

export function Code({ children }: { children: string }) {
  const c = useTheme();
  return <Text style={[s.code, { backgroundColor: c.kerb, color: c.onKerb }]}>{children}</Text>;
}

export function PSign({ size = 44 }: { size?: number }) {
  const c = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size * 0.27, backgroundColor: c.sign, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.onSign, fontFamily: font.display, fontSize: size * 0.58 }}>P</Text>
    </View>
  );
}

const s = StyleSheet.create({
  code: { fontFamily: font.mono, fontSize: 12.5, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden", alignSelf: "flex-start" }
});
