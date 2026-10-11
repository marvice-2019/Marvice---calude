import { Tabs } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { font, useTheme } from "@/lib/theme";

// Same five destinations and icons as the web tab bar.
const ICONS: Record<string, string> = {
  index: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3",
  valet: "M5 17h14M6 17l1.5-5h9L18 17M8 12l1-3h6l1 3M7 20v-3m10 3v-3",
  passes: "M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM14 7v12",
  monthly: "M5 5h14v15H5zM5 10h14M9 3v4m6-4v4",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0"
};

export default function TabsLayout() {
  const c = useTheme();
  return (
    <Tabs screenOptions={({ route }) => ({
      headerStyle: { backgroundColor: c.surface }, headerTintColor: c.ink, headerTitleStyle: { fontFamily: font.displaySemi, fontSize: 22 }, headerShadowVisible: false,
      tabBarActiveTintColor: c.sign, tabBarInactiveTintColor: c.muted, tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, minHeight: 60 },
      tabBarLabelStyle: { fontFamily: font.bodyBold, fontSize: 11.5 },
      tabBarIcon: ({ color }) => (
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><Path d={ICONS[route.name]} /></Svg>
      )
    })}>
      <Tabs.Screen name="index" options={{ title: "Find", headerShown: false }} />
      <Tabs.Screen name="valet" options={{ title: "Valet" }} />
      <Tabs.Screen name="passes" options={{ title: "Passes" }} />
      <Tabs.Screen name="monthly" options={{ title: "Monthly" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
