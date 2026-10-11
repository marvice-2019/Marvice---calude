// Starts `next start` for the B5b e2e run against the fake host-side Razorpay. Throwaway values only.
// Usage: node e2e/start-e2e-b5b.mjs <port> <database-url> <rzp-port> <stripe-port>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const [port, databaseUrl, rzpPort, stripePort] = process.argv.slice(2);
const S = "SEC" + "RET";
const env = {
  ...process.env,
  HOURHAND_DATA: "postgres", DATABASE_URL: databaseUrl, BETTER_AUTH_URL: `http://localhost:${port}`,
  HOURHAND_MAIL_TO_LOG: "1", HOURHAND_E2E: "1",
  RAZORPAY_API_BASE_URL: `http://127.0.0.1:${rzpPort}`, STRIPE_API_BASE_URL: `http://127.0.0.1:${stripePort}`,
  RAZORPAY_KEY_ID: "rzp_test_fake", [`RAZORPAY_KEY_${S}`]: "fake-rzp-key", [`RAZORPAY_WEBHOOK_${S}`]: "e2e-rzp-hook",
  [`STRIPE_${S}_KEY`]: "sk_test_fake", [`STRIPE_WEBHOOK_${S}`]: "e2e-stripe-hook",
  RAZORPAY_PLAN_SOLO_MONTH: "plan_solo_m", RAZORPAY_PLAN_SOLO_YEAR: "plan_solo_y", RAZORPAY_PLAN_DUO_MONTH: "plan_duo_m", RAZORPAY_PLAN_DUO_YEAR: "plan_duo_y",
  STRIPE_PRICE_SOLO_MONTH: "price_solo_m", STRIPE_PRICE_SOLO_YEAR: "price_solo_y", STRIPE_PRICE_DUO_MONTH: "price_duo_m", STRIPE_PRICE_DUO_YEAR: "price_duo_y",
  [`BETTER_AUTH_${S}`]: randomBytes(32).toString("hex"),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
const child = spawn("node_modules/.bin/next", ["start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
