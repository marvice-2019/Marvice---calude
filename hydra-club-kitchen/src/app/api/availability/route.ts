import { getAvailability, getSlots } from "@/booking/service";
import { getDb } from "@/db";
import { failed, json } from "@/lib/http";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/availability?date=YYYY-MM-DD           → time slots with free-table counts
 * GET /api/availability?date=YYYY-MM-DD&time=HH:mm → state of every table at that time
 * `date` is the night (service date); 00:00 on the 4th's list means just after midnight.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const time = url.searchParams.get("time");
  const db = getDb();
  const settings = await getSettings(db);
  const result = time ? await getAvailability(db, settings, date, time) : await getSlots(db, settings, date);
  return result.ok ? json(result) : failed(result);
}
