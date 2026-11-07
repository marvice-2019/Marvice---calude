import { createBooking } from "@/booking/service";
import { getDb } from "@/db";
import { BadBody, badBody, failed, json, notifyLater, readJson } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { verifyTurnstile } from "@/lib/turnstile";

/** POST /api/bookings → 201 { ok, booking } with a pending booking (ref HYD-XXXX). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
  const db = getDb();
  const result = await createBooking(db, await getSettings(db), body, {
    ip: clientIp(req.headers),
    verifyCaptcha: verifyTurnstile,
  });
  if (!result.ok) return failed(result);
  notifyLater(result.event);
  return json({ ok: true, booking: result.booking }, 201);
}
