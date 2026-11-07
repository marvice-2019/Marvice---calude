import { requireApiUser } from "@/auth/guard";
import { adminListBookings, adminTransition, createWalkIn } from "@/booking/service";
import { getDb } from "@/db";
import { BadBody, badBody, failed, json, notifyLater, readJson } from "@/lib/http";
import { getSettings } from "@/lib/settings";

/** GET /api/admin/bookings?date=&status=&zone= (defaults to tonight's service date). */
export async function GET(req: Request) {
  const user = await requireApiUser(req, "bookings:read");
  if (user instanceof Response) return user;
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const result = await adminListBookings(getDb(), q);
  return result.ok ? json(result) : failed(result);
}

/** PATCH /api/admin/bookings { id, action: confirm | cancel | no_show | complete } */
export async function PATCH(req: Request) {
  const user = await requireApiUser(req, "bookings:write");
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
  const result = await adminTransition(getDb(), user.id, body);
  if (!result.ok) return failed(result);
  notifyLater(result.event);
  return json({ ok: true, booking: result.booking });
}

/** POST /api/admin/bookings { table, time: "now" | HH:mm, guests, name, phone?, notes? } → a confirmed walk-in tonight. */
export async function POST(req: Request) {
  const user = await requireApiUser(req, "bookings:write");
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
  const db = getDb();
  const result = await createWalkIn(db, await getSettings(db), user.id, body);
  return result.ok ? json(result, 201) : failed(result);
}
