import { getPool } from "@/lib/data/pg-store";

export const dynamic = "force-dynamic";

/** Liveness for Coolify's healthcheck and uptime monitors: 200 when the server can reach its database, 503 when it can't. */
export async function GET() {
  if (process.env.HOURHAND_DATA !== "postgres") return Response.json({ ok: true, data: "memory" });
  try {
    await getPool(process.env.DATABASE_URL as string).query("select 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "database_unreachable" }, { status: 503 });
  }
}
