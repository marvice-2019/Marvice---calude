# Bayline app: phone test kit

What CI can't check. Run this on a real phone before the first store submission, and again after any change to payments, notifications or links. Allow about 45 minutes per platform.

Tick each box and note the phone model and OS version. Any ✗ blocks release.

## 0. Setup (once)

1. Run the API and web app on a laptop on the same Wi-Fi as the phone (see `../api/README.md` and `../web/README.md`).
   - Seed sample lots: `psql "$DATABASE_URL" -f ../api/seed/dev.sql`
   - Start the web app with `DEV_FAKE_PAY=1` so test payments settle without real money.
2. Find the laptop's LAN IP (for example `192.168.1.20`).
3. Build and install a development build.
   - **Android:** `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 EXPO_PUBLIC_DEV_PAY_URL=http://192.168.1.20:3001/api/dev/pay npm run android`
   - **iOS (Mac + Xcode):** same variables with `npm run ios -- --device`
   - **Or EAS** (no local Android Studio or Xcode): `eas build --profile development --platform android`. First set the two URLs in `eas.json` → `build.development.env` to your LAN IP.
4. Razorpay test mode only: put test keys (`rzp_test_…`) in the API's `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` for section 2. Never use live keys on a test build.

Test phones: one Android 13+ (the notification permission prompt), one Android 10–12 budget phone (Redmi or Realme class), and one iPhone on iOS 17+.

## 1. Find, map and location

- [ ] First launch shows the dusk hero and MG Road lots with totals "incl. GST".
- [ ] Tap **Near me**. The system prompt shows the text "Bayline uses your location only when you tap Near me…".
- [ ] Deny → an inline message explains how to search instead; the app keeps working.
- [ ] Allow → the list re-sorts around you (or shows "No bays here" outside Bengaluru, which is expected).
- [ ] **Map** shows real map tiles with pins. On Android this needs the Maps key in `GOOGLE_MAPS_ANDROID_KEY`; a grey map means the key is missing or restricted.
- [ ] Tap a pin callout → the lot screen opens.

## 2. Checkout and UPI (Razorpay test mode)

- [ ] On a lot, sign in with the OTP. In dev, the code appears in the API log.
- [ ] The bill lines read: parking, platform fee ₹15, GST 18%, total. The total matches the web app for the same lot and times.
- [ ] Pay with **UPI** on Android with GPay, PhonePe and Paytm installed. The Razorpay sheet lists those apps (this confirms the `upi:` query plugin) and opens the chosen one.
- [ ] Close the sheet without paying. The app says the bay is held for 10 minutes. Tap Pay again: the sheet reopens and no second booking appears in Passes.
- [ ] **iOS:** close the sheet. Note the message shown. If it says "didn't go through" instead of "Payment closed", record the error code from the console. `lib/pay.ts` treats code 0 as cancel, and iOS may use a different code.
- [ ] A successful payment lands on Passes with "Confirming payment…", then the pass appears within about 5 seconds.
- [ ] Card and netbanking each complete once with Razorpay test credentials.

## 3. Passes offline

- [ ] With a live pass, turn on airplane mode, force-quit the app and reopen it.
- [ ] Passes shows "No signal. Showing passes saved … ago". The QR and the code render. Extend and Cancel are hidden with a reason.
- [ ] A gate scanner (or any QR app) reads the QR as the booking code, for example `BL-7Q2K`.
- [ ] Turn airplane mode off and pull to refresh. The banner goes away.

## 4. Reminder notification

- [ ] Book a Park now pass for 1 hour. Android 13+ asks for notification permission on the first booking.
- [ ] 15 minutes before the end, a "15 minutes left" notification arrives, even with the app closed.
- [ ] Tapping it opens Passes.
- [ ] Extend by an hour. The reminder moves to the new end time, and no second reminder fires at the old time.
- [ ] Cancel a future booking. Its reminder never fires.

## 5. Links

- [ ] From a WhatsApp message to yourself, tap `bayline://passes`. The app opens on Passes.
- [ ] With `PASS_HOST` set at build and the domain serving `/.well-known/assetlinks.json` (Android) and `/.well-known/apple-app-site-association` (iOS), tap `https://<PASS_HOST>/passes`. It opens the app, not the browser.

## 6. Valet, monthly, account

- [ ] A valet ticket created by staff (API `/v1/valet/tickets` or the stage 7 staff app) appears in Valet for that phone number.
- [ ] Bring my car with a ₹20 tip pays fee + GST + tip. With validation code `DINE24` at the UB City desk, only the tip is charged.
- [ ] The status moves to Requested, then On the way, then At the porch, refreshing by itself about every 8 seconds.
- [ ] Monthly: requesting a bay shows "Request sent".
- [ ] Account: changing language or payment preference shows "Saved."
- [ ] Sign out clears saved passes, so the next person on this phone can't see them.

## 7. Accessibility and feel

- [ ] TalkBack (Android) and VoiceOver (iOS): each lot reads as name, distance, total and bays free. The pass QR reads "Gate QR for pass …".
- [ ] Largest system font: nothing is clipped on Find, Lot or Passes.
- [ ] Dark mode follows the system and every screen stays readable.
- [ ] A short vibration plays when payment succeeds and a different one when it fails.

## Report back

For each failure, record the phone, OS version, the step, what happened, and a screenshot. Note the platform with the issue. The iOS Razorpay cancel code is the one most likely to need a one-line change in `lib/pay.ts`.
