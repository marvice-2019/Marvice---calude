import { LOOKUP_RATE_LIMIT as LOOKUP_LIMIT, lookupBooking } from "@/booking/service";
import { getDb } from "@/db";
import { failed, json } from "@/lib/http";
import { clientIp, consume } from "@/lib/rate-limit";

/** GET /api/bookings/HYD-XXXX?last4=3210 → the guest's own booking. */
export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const db = getDb();
  const limited = await consume(db, `lookup:ip:${clientIp(req.headers)}`, LOOKUP_LIMIT.limit, LOOKUP_LIMIT.windowSec);
  if (!limited.ok) {
    return failed({ ok: false, status: 429, code: "rate_limited", message: "Too many lookups. Try again later.", retryAfterSec: limited.retryAfterSec });
  }
  const { ref } = await params;
  const last4 = new URL(req.url).searchParams.get("last4");
  const result = await lookupBooking(db, { ref: ref.toUpperCase(), last4 });
  return result.ok ? json(result) : failed(result);
}
