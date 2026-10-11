---
name: replica-mobile
description: Stage 6 of the Replica pipeline. Build the iOS and Android app with Expo (React Native) for a replica product, sharing types and the API client with the web app. Use when the user says go for the mobile stage or asks to build the replica mobile app.
argument-hint: <product folder>
---

# Replica mobile

Build `<product>-app/mobile/` with Expo (latest SDK, TypeScript, Expo Router). Before writing code, check the current Expo SDK version and the Razorpay React Native SDK compatibility in their docs.

## Build

- Tabs matching the prototype: Find, Passes, Monthly, Account. Use the same tokens and type as web.
- A map with real tiles (react-native-maps or MapLibre). Use location permission only when the user taps "near me", and include a clear permission explanation string.
- Checkout through the Razorpay SDK, with UPI intent on Android.
- Passes stored offline (SecureStore or SQLite), so a pass opens without signal at a basement gate.
- Push for expiry alerts (Expo Notifications), plus a deep link from the WhatsApp pass into the app.
- Shared `packages/` for types and the API client with web, if the repo becomes a monorepo. Otherwise copy them via a script.

## Tests

- jest + React Native Testing Library for the checkout and pass components.
- Type-check, lint, and `npx expo export --platform web` as a smoke build.
- Write the EAS build profiles (`eas.json`) but do not run a store build; that needs the user's Apple and Google accounts.

## Gate

Type-check, tests and the Expo web export green, with the output shown. List anything that needs a real device.
Commit as "Mobile: <product>" and stop for the user's go.
