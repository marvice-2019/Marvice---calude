import * as Sentry from "@sentry/node";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { fakePayments, notifier, otpSender, razorpay, storage } from "./providers.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const log = { info: (o: object, m: string) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o: object, m: string) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })) };
const payments = cfg.RAZORPAY_KEY_ID && cfg.RAZORPAY_KEY_SECRET ? razorpay(cfg) : fakePayments(cfg);
// Error tracking only when a DSN is set. No request bodies or user data are sent (sendDefaultPii off).
if (cfg.SENTRY_DSN) Sentry.init({ dsn: cfg.SENTRY_DSN, environment: cfg.APP_ENV, sendDefaultPii: false, tracesSampleRate: 0 });
const app = await buildApp({ cfg, db, payments, otp: otpSender(cfg, m => log.info({}, m)), notify: notifier(cfg, log), storage: storage(cfg) });
if (cfg.SENTRY_DSN) app.addHook("onError", async (req, _reply, err) => {
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return; // user errors (validation, auth) are not incidents
  Sentry.captureException(err, { tags: { route: req.routeOptions.url ?? "unknown", method: req.method } });
});
log.info({ app_env: cfg.APP_ENV, payments: payments.keyId === "rzp_test_fake" ? "fake" : payments.keyId.slice(0, 9) }, "starting");

const close = async () => { await app.close(); await db.end(); await Sentry.close(2000).catch(() => false); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);
await app.listen({ host: "0.0.0.0", port: cfg.PORT });
