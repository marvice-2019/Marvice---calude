// Android 11+ hides other apps unless the manifest declares what we look for. Razorpay's UPI intent flow
// lists installed UPI apps (GPay, PhonePe, Paytm, BHIM) by resolving upi:// links, so declare that query.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    const upi = { action: [{ $: { "android:name": "android.intent.action.VIEW" } }], data: [{ $: { "android:scheme": "upi" } }] };
    manifest.queries = manifest.queries ?? [{}];
    const q = manifest.queries[0];
    q.intent = q.intent ?? [];
    if (!q.intent.some(i => i.data?.[0]?.$?.["android:scheme"] === "upi")) q.intent.push(upi);
    return cfg;
  });
};
