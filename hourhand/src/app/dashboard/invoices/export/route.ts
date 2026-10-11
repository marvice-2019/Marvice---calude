import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/auth";
import { getSignedInUser } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { invoicesCsv, listInvoices } from "@/lib/gst/invoices";

export const dynamic = "force-dynamic";

/** GET ?month=YYYY-MM: the signed-in host's invoices and credit notes for that month (IST), as CSV. */
export async function GET(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user || !authEnabled()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return NextResponse.json({ error: "invalid_request", fields: { month: "Use YYYY-MM." } }, { status: 400 });
  const IST = 330 * 60_000;
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) - IST);
  const to = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - IST);
  const csv = invoicesCsv((await listInvoices(getPool(process.env.DATABASE_URL as string), user.id, { from, to })).reverse());
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="invoices-${month}.csv"` } });
}
