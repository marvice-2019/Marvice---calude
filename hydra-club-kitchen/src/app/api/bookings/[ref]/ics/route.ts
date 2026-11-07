import { bookingIcs } from "@/booking/ics";
import { bookingForIcs } from "@/booking/service";
import { getDb } from "@/db";
import { json } from "@/lib/http";
import { getSettings } from "@/lib/settings";

/** GET /api/bookings/HYD-XXXX/ics?last4=3210 → add-to-calendar file. */
export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const db = getDb();
  const { ref } = await params;
  const b = await bookingForIcs(db, { ref: ref.toUpperCase(), last4: new URL(req.url).searchParams.get("last4") });
  if (!b) return json({ ok: false, code: "not_found", message: "Booking not found." }, 404);
  const { address } = await getSettings(db);
  const siteHost = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? req.url).host;
  return new Response(bookingIcs({ ...b, address, siteHost }), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="hydra-${b.ref}.ics"`,
      "cache-control": "no-store",
    },
  });
}
