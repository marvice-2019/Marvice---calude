import { Archivo_700Bold, Archivo_800ExtraBold } from "@expo-google-fonts/archivo";
import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { useFonts } from "expo-font";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { onReminderTap } from "@/lib/notify";
import { font, useTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function Root() {
  const c = useTheme();
  const [loaded, error] = useFonts({ Archivo_700Bold, Archivo_800ExtraBold, AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold, IBMPlexMono_500Medium });
  useEffect(() => { if (loaded || error) SplashScreen.hideAsync().catch(() => undefined); }, [loaded, error]);
  // Expiry reminder tap → the pass. WhatsApp links (bayline://passes or https://<PASS_HOST>/passes) route by file name.
  useEffect(() => onReminderTap(url => router.push(url as never)), []);
  if (!loaded && !error) return null;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: c.surface }, headerTintColor: c.ink, headerTitleStyle: { fontFamily: font.displaySemi },
        contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="lot/[id]" options={{ title: "", headerBackTitle: "Lots" }} />
        <Stack.Screen name="park-now" options={{ title: "Park now", presentation: "modal" }} />
      </Stack>
    </>
  );
}
