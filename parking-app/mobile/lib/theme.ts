import { useColorScheme } from "react-native";

// Same "dusk on the ring road" tokens as web/app/globals.css, so the app and site read as one product.
const light = {
  bg: "#F4F6FB", surface: "#FFFFFF", surface2: "#F8FAFD", ink: "#0E1A33", muted: "#5A6683", line: "#E0E6F0",
  sign: "#1446A0", sign2: "#2B63D9", onSign: "#FFFFFF", kerb: "#F2B705", kerbSoft: "#FFF4CC", onKerb: "#14110A",
  ok: "#138A4E", okSoft: "#E2F4EA", warn: "#B45309", warnSoft: "#FDEEDD", tint: "#E8EFFC",
  dusk1: "#081633", dusk2: "#112C66", dusk3: "#1D4DB0"
};
const dark: typeof light = {
  bg: "#070D1A", surface: "#0F1729", surface2: "#131D33", ink: "#E8EDF7", muted: "#97A3BD", line: "#22304C",
  sign: "#6E9BFF", sign2: "#8FB2FF", onSign: "#07122B", kerb: "#F6C83A", kerbSoft: "#3A3010", onKerb: "#14110A",
  ok: "#45C882", okSoft: "#10301F", warn: "#F2A35B", warnSoft: "#3A2412", tint: "#16264A",
  dusk1: "#081633", dusk2: "#112C66", dusk3: "#1D4DB0"
};
export type Palette = typeof light;

export const font = {
  display: "Archivo_800ExtraBold", displaySemi: "Archivo_700Bold",
  body: "AtkinsonHyperlegible_400Regular", bodyBold: "AtkinsonHyperlegible_700Bold",
  mono: "IBMPlexMono_500Medium"
};
export const radius = { xl: 24, l: 18, m: 12, s: 8 };
export const space = (n: number) => n * 4;

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
export const palettes = { light, dark };
