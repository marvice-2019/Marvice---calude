import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3001"),
  OTP_PROVIDER: z.enum(["console", "msg91", "twilio"]).default("console"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  N8N_NOTIFY_URL: z.string().url().optional(),
  INTERNAL_TOKEN: z.string().min(16),
  PLATFORM_FEE_PAISE: z.coerce.number().int().default(1500),
  COMMISSION_BPS: z.coerce.number().int().default(1500),
  TDS_BPS: z.coerce.number().int().default(100), // 1% under 194-O; confirm with CA
  RATE_LIMIT_MAX: z.coerce.number().int().default(120),
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).default(1) // tests raise per-route limits; keep 1 in production
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  if (parsed.data.NODE_ENV === "production" && (!parsed.data.RAZORPAY_KEY_ID || !parsed.data.RAZORPAY_KEY_SECRET)) {
    throw new Error("Invalid environment: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.OTP_PROVIDER === "console") {
    throw new Error("Invalid environment: OTP_PROVIDER=console is not allowed in production");
  }
  return parsed.data;
}
