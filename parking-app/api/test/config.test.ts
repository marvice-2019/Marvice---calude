import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "j".repeat(40), RAZORPAY_WEBHOOK_SECRET: "w", INTERNAL_TOKEN: "i".repeat(16) };
const load = (extra: Record<string, string>) => () => loadConfig({ ...base, ...extra } as NodeJS.ProcessEnv);

describe("deployment environments (stage 8)", () => {
  it("NODE_ENV=production without APP_ENV is treated as production: no console OTP, no fake gateway", () => {
    expect(load({ NODE_ENV: "production", OTP_PROVIDER: "msg91" })).toThrow(/RAZORPAY_KEY_ID/);
    expect(load({ NODE_ENV: "production", RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s" })).toThrow(/OTP_PROVIDER=console/);
    expect(load({ NODE_ENV: "production", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s", OTP_PROVIDER: "msg91" })).toThrow(/live Razorpay keys/);
    expect(load({ NODE_ENV: "production", RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s", OTP_PROVIDER: "msg91" })().APP_ENV).toBe("production");
  });

  it("staging may run console OTP and the test gateway for closed testing", () => {
    const c = load({ NODE_ENV: "production", APP_ENV: "staging" })();
    expect(c.APP_ENV).toBe("staging");
    expect(c.OTP_PROVIDER).toBe("console");
  });

  it("local is the default outside production, and SENTRY_DSN must be a URL", () => {
    expect(load({})().APP_ENV).toBe("local");
    expect(load({ SENTRY_DSN: "not-a-url" })).toThrow(/SENTRY_DSN/);
  });

  it("an optional URL left blank (compose passes ${X:-} as an empty string) counts as unset", () => {
    const c = load({ SENTRY_DSN: "", N8N_NOTIFY_URL: "" })();
    expect(c.SENTRY_DSN).toBeUndefined();
    expect(c.N8N_NOTIFY_URL).toBeUndefined();
  });
});
