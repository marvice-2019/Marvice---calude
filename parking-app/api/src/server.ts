import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { fakePayments, notifier, otpSender, razorpay, storage } from "./providers.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const log = { info: (o: object, m: string) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o: object, m: string) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })) };
const payments = cfg.RAZORPAY_KEY_ID && cfg.RAZORPAY_KEY_SECRET ? razorpay(cfg) : fakePayments(cfg);
const app = await buildApp({ cfg, db, payments, otp: otpSender(cfg, m => log.info({}, m)), notify: notifier(cfg, log), storage: storage(cfg) });

const close = async () => { await app.close(); await db.end(); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);
await app.listen({ host: "0.0.0.0", port: cfg.PORT });
