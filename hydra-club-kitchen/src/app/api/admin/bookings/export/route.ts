import { exportBookingsCsv } from "@/admin/export";
import { requireApiUser } from "@/auth/guard";
import { getDb } from "@/db";
import { json } from "@/lib/http";

/** GET /api/admin/bookings/export?from=YYYY-MM-DD&to=YYYY-MM-DD → text/csv (owner and manager). */
export async function GET(req: Request) {
  const user = await requireApiUser(req, "bookings:export");
  if (user instanceof Response) return user;
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const result = await exportBookingsCsv(getDb(), user.id, q);
  if (!result.ok) return json({ ok: false, code: "invalid", message: result.message }, 400);
  return new Response(result.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hydra-bookings-${result.from}-to-${result.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
