import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { BillingApiError } from "../billing/providers";
import { seal, unseal } from "../crypto/seal";

// The host's own Razorpay account. Guests pay the host directly: Hourhand creates orders with the host's key pair,
// so the money never passes through Marvice. The pair is sealed with TOKEN_ENCRYPTION_KEY and bound to its owner.

type Db = Pick<pg.Pool, "query">;
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

/** How Hourhand authenticates to a host's Razorpay. A key pair today; an OAuth token can implement the same shape later. */
export interface HostRazorpayAuth {
  headers(): Record<string, string>;
  keyId: string;
  /** Checkout's razorpay_signature for an order and payment. Lives here because an OAuth connection signs differently. */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
}

export type RazorpayMode = "test" | "live";

const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;

export type RazorpayKeyProblem = "format" | "rejected" | "unreachable";

/** Why a key pair wasn't saved. `rejected`: Razorpay said the pair is wrong; `unreachable`: try again later. */
export class RazorpayKeyError extends Error {
  constructor(readonly code: RazorpayKeyProblem, message: string) {
    super(message);
    this.name = "RazorpayKeyError";
  }
}

export function keyPairAuth(keyId: string, keySecret: string): HostRazorpayAuth {
  const value = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  return {
    keyId,
    headers: () => ({ authorization: value }),
    verifyPaymentSignature(orderId, paymentId, signature) {
      const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest();
      if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
      return timingSafeEqual(expected, Buffer.from(signature, "hex"));
    },
  };
}

const aad = (userId: string, keyId: string) => `razorpay:${userId}:${keyId}`;

/** Test-only base URL, honoured outside production or in an end-to-end run (same rule as billing). */
export function razorpayApiBase(env: Env = process.env): string {
  const fake = env.NODE_ENV !== "production" || env.HOURHAND_E2E === "1" ? env.RAZORPAY_API_BASE_URL : undefined;
  return (fake ?? "https://api.razorpay.com").replace(/\/+$/, "");
}

/** Checks a key pair against the host's Razorpay with the cheapest authenticated read there is. */
export function razorpayVerifier(baseUrl = razorpayApiBase(), fetchImpl: Fetch = fetch): (auth: HostRazorpayAuth) => Promise<void> {
  const base = baseUrl.replace(/\/+$/, "");
  return async (auth) => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/v1/orders?count=1`, { headers: auth.headers(), signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new BillingApiError(`Could not reach Razorpay: ${(error as Error).message}`, null, true);
    }
    if (!res.ok) throw new BillingApiError(`Razorpay ${res.status}`, res.status, res.status === 429 || res.status >= 500);
  };
}

/** Validates, checks with Razorpay, then stores the pair. Nothing is stored unless Razorpay accepted it. */
export async function saveRazorpayKeys(db: Db, key: Buffer, userId: string, keyId: string, keySecret: string, verify: (auth: HostRazorpayAuth) => Promise<void>): Promise<{ mode: RazorpayMode }> {
  keyId = keyId.trim();
  keySecret = keySecret.trim();
  const m = KEY_ID.exec(keyId);
  if (!m) throw new RazorpayKeyError("format", "That doesn't look like a Razorpay key id (it starts with rzp_test_ or rzp_live_).");
  if (!keySecret || keySecret.length > 128) throw new RazorpayKeyError("format", "Paste the key secret that Razorpay showed with this key id.");
  try {
    await verify(keyPairAuth(keyId, keySecret));
  } catch (error) {
    if (error instanceof BillingApiError && (error.status === 401 || error.status === 403)) {
      throw new RazorpayKeyError("rejected", "Razorpay didn't accept this key pair.");
    }
    throw new RazorpayKeyError("unreachable", `Couldn't check the keys with Razorpay: ${(error as Error).message}`);
  }
  const mode = m[1] as RazorpayMode;
  await db.query(
    `insert into integrations (user_id, provider, credentials_encrypted, public_id, mode, status)
     values ($1, 'razorpay', $2, $3, $4, 'ok')
     on conflict (user_id, provider) do update
       set credentials_encrypted = excluded.credentials_encrypted, public_id = excluded.public_id, mode = excluded.mode, status = 'ok', updated_at = now()`,
    [userId, seal(key, { keyId, keySecret }, aad(userId, keyId)), keyId, mode]);
  return { mode };
}

/** The host's Razorpay access, or null when not connected. Throws if the stored value was tampered with or moved. */
export async function loadHostRazorpay(db: Db, key: Buffer, userId: string): Promise<(HostRazorpayAuth & { mode: RazorpayMode }) | null> {
  const { rows } = await db.query(
    "select credentials_encrypted, public_id, mode from integrations where user_id = $1 and provider = 'razorpay' and status = 'ok'", [userId]);
  const r = rows[0];
  if (!r) return null;
  const pair = unseal<{ keyId: string; keySecret: string }>(key, r.credentials_encrypted, aad(userId, r.public_id));
  return { ...keyPairAuth(pair.keyId, pair.keySecret), mode: r.mode };
}

/** What the integrations page shows: never the secret. */
export async function razorpayStatus(db: Db, userId: string): Promise<{ keyId: string; mode: RazorpayMode } | null> {
  const { rows } = await db.query("select public_id, mode from integrations where user_id = $1 and provider = 'razorpay' and status = 'ok'", [userId]);
  return rows[0] ? { keyId: rows[0].public_id, mode: rows[0].mode } : null;
}

export async function disconnectRazorpay(db: Db, userId: string): Promise<void> {
  await db.query("delete from integrations where user_id = $1 and provider = 'razorpay'", [userId]);
}

/** rzp_test_••••AbCd: enough for the host to recognise which key is connected. */
export function maskKeyId(keyId: string): string {
  const m = /^(rzp_(?:test|live)_)(.*)$/.exec(keyId);
  return m ? `${m[1]}••••${m[2].slice(-4)}` : "••••";
}
