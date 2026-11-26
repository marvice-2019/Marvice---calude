import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64'),
  META_APP_SECRET: z.string().min(1),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  /** Meta app id and Embedded Signup configuration id (Facebook Login for Business). Signup is off until both are set. */
  META_APP_ID: z.string().regex(/^\d+$/).optional(),
  META_ES_CONFIG_ID: z.string().regex(/^\d+$/).optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default('2025-10'),
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  SUPPLIER_STATE_CODE: z.string().regex(/^\d{2}$/).default('29'),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  /** Comma-separated web app origins allowed to open the live inbox socket. */
  WEB_ORIGINS: z.string().default('').transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
  /** AI reply suggestions. Off until AI_API_KEY is set. */
  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  AI_BASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return parsed.data;
}
