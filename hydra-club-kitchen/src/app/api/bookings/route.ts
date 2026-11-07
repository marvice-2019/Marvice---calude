import { after } from "next/server";
import { createBooking } from "@/booking/service";
import { sendLead } from "@/lib/capi";
import { allowsAds, parseConsent } from "@/lib/consent";
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
  // Meta Conversions API, only with ad consent; never delays the guest.
  const event = result.event;
  if (event && event.payload.phone_e164 && allowsAds(parseConsent(req.headers.get("cookie")))) {
    const phone = event.payload.phone_e164;
    after(() =>
      sendLead({
        ref: event.payload.ref,
        phoneE164: phone,
        ip: clientIp(req.headers),
        userAgent: req.headers.get("user-agent"),
        cookies: req.headers.get("cookie"),
        url: req.headers.get("referer") ?? `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/book`,
      }),
    );
  }
  return json({ ok: true, booking: result.booking }, 201);
}
