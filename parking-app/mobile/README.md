# Bayline app (stage 6)

Expo SDK 57 (the npm `latest` tag on 11 Oct 2026; SDK 58 was still `next`), React Native 0.86, Expo Router, TypeScript strict. Same tokens and typefaces as the web app: Archivo for headings, Atkinson Hyperlegible for text, IBM Plex Mono for codes and plates, light and dark themes.

## Screens

| Route | What it does | Stories |
|---|---|---|
| Find (`app/(tabs)/index.tsx`) | Destination search, **Near me** (location asked only on tap), arrival and duration chips, list or map, Park now entry | DRV-01, DRV-15 |
| Lot (`app/lot/[id].tsx`) | Facts, directions, checkout with bill, promo, plate, UPI/card/netbanking, inline OTP | DRV-02, DRV-04–07 |
| Park now (`app/park-now.tsx`) | Digits from the entrance board → hours → pay | DRV-09 |
| Passes | QR passes saved in SQLite for no-signal gates, polling until the webhook issues the pass, +1 hour, cancel, Mark my spot | DRV-10–12, DRV-14 |
| Valet | Live status and ETA, tip chips, validation code, nearby desks with GST | VAL-02–05 |
| Monthly | Request a monthly bay | MON-01 |
| Account | Preferences, data export, sign out, delete | ACC-01, ACC-02 |
| Staff mode (`app/staff.tsx`, from Account for staff roles) | Scan pass QR (camera) or type plate, check in/out, overstay to collect, offline scan queue, today's arrivals | OPS-01, OPS-02, DRV-13 |

## How the pieces work

- **API:** direct HTTPS with a bearer token. Tokens live in the Keychain / Android Keystore (`expo-secure-store`); one refresh on 401.
- **Payments:** `react-native-razorpay` native SDK. Android declares a `upi:` intent query (`plugins/withUpiQueries.js`) so Razorpay can list GPay, PhonePe and Paytm on Android 11+. iOS declares `tez`, `phonepe` and `paytmmp` in `LSApplicationQueriesSchemes`, as Razorpay's README says. The pass is issued by the API webhook, so the app polls after payment.
- **Offline passes:** `expo-sqlite/kv-store`. The QR is drawn on the device.
- **Expiry reminder:** a local notification 15 minutes before the pass ends, scheduled after payment and refreshed whenever passes reload. Tapping it opens Passes.
- **Deep links:** scheme `bayline://passes?new=<id>`. Set `PASS_HOST` at build time to also open `https://<PASS_HOST>/passes...` links from the WhatsApp pass (Android App Links + iOS associated domains). The domain must serve `assetlinks.json` and `apple-app-site-association` first.
- **Maps:** `react-native-maps` (Apple Maps on iOS; Google Maps on Android needs `GOOGLE_MAPS_ANDROID_KEY` at build time).
- **Shared code:** `shared/` is generated from `../web/lib` by `npm run sync-shared`. Don't edit it by hand; CI fails if it's stale.

## Run

```sh
npm ci
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000 npx expo run:android   # dev build; Razorpay is a native module, so Expo Go won't do
```

For the fake gateway in dev, also set `EXPO_PUBLIC_DEV_PAY_URL=http://<LAN-IP>:3001/api/dev/pay` (the web app's dev-only route). It only works while the web app runs with `DEV_FAKE_PAY=1`.

## Checks

`npm run typecheck`, `npm run lint`, `npm test` (jest-expo + React Native Testing Library: 9 checkout tests, 5 pass-card tests), `npm run export:web` (smoke build), `node scripts/sync-shared.mjs --check`.

EAS profiles are in `eas.json` (development, preview APK, production). No store build has been run; that needs the Apple and Google developer accounts. The API URLs in `eas.json` use `.example` domains until the real ones exist.

## Needs a real device

- Staff mode: QR scanning with the back camera in a dim basement, and a queued scan sending itself when signal returns.
- Razorpay sheet, UPI intent hand-off to GPay/PhonePe/Paytm, and the iOS cancel error code.
- Map tiles (Android needs the Maps key).
- Location prompt wording on both platforms.
- Local notification timing and tap-to-open.
- WhatsApp deep link opening the app (needs `PASS_HOST` and the domain verification files).
- Offline pass with the phone in airplane mode.
