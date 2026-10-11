import { authEnabled } from "../auth/auth";
import { hostPlan } from "../billing/account";
import { tokenKey } from "../crypto/seal";
import type { PaymentDeps } from "../booking";
import { getPool } from "../data/pg-store";
import { loadHostRazorpay } from "./host-razorpay";
import { razorpayOrders } from "./razorpay-orders";

/** What the booking routes use to reach hosts' Razorpay, or null when this server can't take payments (no Postgres or no TOKEN_ENCRYPTION_KEY). */
export function requestPaymentDeps(): PaymentDeps | null {
  if (!authEnabled()) return null;
  let key: Buffer;
  try {
    key = tokenKey();
  } catch {
    return null;
  }
  const pool = getPool(process.env.DATABASE_URL!);
  return {
    pool,
    authFor: (hostId) => loadHostRazorpay(pool, key, hostId),
    ordersFor: (auth) => razorpayOrders(auth),
    planFor: (hostId) => hostPlan(pool, hostId),
  };
}
