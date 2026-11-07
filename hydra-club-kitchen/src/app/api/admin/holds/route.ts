import { requireApiUser } from "@/auth/guard";
import { createHold, deleteHold, listHolds } from "@/booking/service";
import { serviceDateOf } from "@/booking/time";
import { getDb } from "@/db";
import { BadBody, badBody, failed, json, readJson } from "@/lib/http";

/** GET /api/admin/holds → holds from tonight onwards. */
export async function GET(req: Request) {
  const user = await requireApiUser(req, "bookings:read");
  if (user instanceof Response) return user;
  return json({ ok: true, holds: await listHolds(getDb(), serviceDateOf(new Date())) });
}

/** POST /api/admin/holds { table | zone, date, reason } → hold + bookings it overlaps. */
export async function POST(req: Request) {
  const user = await requireApiUser(req, "holds:write");
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
  const result = await createHold(getDb(), user.id, body);
  return result.ok ? json(result, 201) : failed(result);
}

/** DELETE /api/admin/holds?id=12 */
export async function DELETE(req: Request) {
  const user = await requireApiUser(req, "holds:write");
  if (user instanceof Response) return user;
  const result = await deleteHold(getDb(), user.id, new URL(req.url).searchParams.get("id"));
  return result.ok ? json(result) : failed(result);
}
