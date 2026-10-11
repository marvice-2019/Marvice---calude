import type { ExpoConfig } from "expo/config";

// Values that differ per build come from EAS env (eas.json) or the shell, never from source.
// PASS_HOST: the web domain WhatsApp pass links point at (https://<host>/passes?...) once it is registered.
const passHost = process.env.PASS_HOST;

const config: ExpoConfig = {
  name: "Bayline",
  slug: "bayline",
  scheme: "bayline",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "in.bayline.app",
    supportsTablet: false,
    associatedDomains: passHost ? [`applinks:${passHost}`] : undefined,
    infoPlist: {
      // UPI apps Razorpay may open (Razorpay React Native README).
      LSApplicationQueriesSchemes: ["tez", "phonepe", "paytmmp"],
      NSLocationWhenInUseUsageDescription: "Bayline uses your location only when you tap Near me, to show parking around you. It isn't tracked or stored."
    }
  },
  android: {
    package: "in.bayline.app",
    adaptiveIcon: {
      backgroundColor: "#081633",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png"
    },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
    // Template defaults the app never uses; dropping them keeps the Play data-safety form and install prompt honest.
    blockedPermissions: ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.SYSTEM_ALERT_WINDOW"],
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
    intentFilters: passHost ? [{
      action: "VIEW", autoVerify: true, category: ["BROWSABLE", "DEFAULT"],
      data: [{ scheme: "https", host: passHost, pathPrefix: "/passes" }]
    }] : undefined
  },
  web: { favicon: "./assets/favicon.png", output: "single" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "expo-font",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", backgroundColor: "#081633", imageWidth: 160 }],
    ["expo-location", { locationWhenInUsePermission: "Bayline uses your location only when you tap Near me, to show parking around you. It isn't tracked or stored." }],
    ["expo-notifications", { color: "#1446A0" }],
    ["expo-camera", { cameraPermission: "Bayline staff mode uses the camera only to scan pass QR codes at the gate.", recordAudioAndroid: false }],
    "./plugins/withUpiQueries"
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    devPayUrl: process.env.EXPO_PUBLIC_DEV_PAY_URL
  }
};

export default config;
