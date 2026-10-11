import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/auth";
import { getSignedInUser } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { earningsCsv, monthlyEarnings } from "@/lib/earnings";

export const dynamic = "force-dynamic";

/** GET ?month=YYYY-MM: the signed-in host's earnings for that month (India time), as CSV. */
export async function GET(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user || !authEnabled()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const e = await monthlyEarnings(getPool(process.env.DATABASE_URL as string), user.id, month, new Date());
  if (!e) return NextResponse.json({ error: "invalid_request", fields: { month: "Use YYYY-MM." } }, { status: 400 });
  return new NextResponse(earningsCsv(e), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="earnings-${month}.csv"` } });
}
