import { billingProviderFromEnv, type BillingProvider } from "./providers";
import type { Provider } from "./plans";

type Env = Record<string, string | undefined>;

const WEBHOOK_KEY_NAME: Record<Provider, string> = { razorpay: "RAZORPAY_WEBHOOK_SECRET", stripe: "STRIPE_WEBHOOK_SECRET" };

/** A provider is usable when its API key and its webhook signing key are both set: without webhooks a paid plan never starts. */
export function billingFor(provider: Provider, env: Env = process.env): { api: BillingProvider; webhookKey: string } | null {
  const api = billingProviderFromEnv(provider, env);
  const webhookKey = env[WEBHOOK_KEY_NAME[provider]];
  return api && webhookKey ? { api, webhookKey } : null;
}
