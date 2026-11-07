import { cancelByGuest, LOOKUP_RATE_LIMIT as LOOKUP_LIMIT } from "@/booking/service";
import { getDb } from "@/db";
import { BadBody, badBody, failed, json, notifyLater, readJson } from "@/lib/http";
import { clientIp, consume } from "@/lib/rate-limit";

/** POST /api/bookings/HYD-XXXX/cancel { last4 } → cancels the guest's own upcoming booking. */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const db = getDb();
  const limited = await consume(db, `lookup:ip:${clientIp(req.headers)}`, LOOKUP_LIMIT.limit, LOOKUP_LIMIT.windowSec);
  if (!limited.ok) {
    return failed({ ok: false, status: 429, code: "rate_limited", message: "Too many attempts. Try again later.", retryAfterSec: limited.retryAfterSec });
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
  const { ref } = await params;
  const last4 = (body as { last4?: unknown } | null)?.last4;
  const result = await cancelByGuest(db, { ref: ref.toUpperCase(), last4 });
  if (!result.ok) return failed(result);
  notifyLater(result.event);
  return json({ ok: true, booking: result.booking });
}
