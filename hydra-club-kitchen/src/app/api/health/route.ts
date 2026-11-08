import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health: liveness + database check for Docker HEALTHCHECK and Coolify.
 * 200 {ok:true} when Postgres answers within 3 s, otherwise 503. Reveals no versions or errors.
 */
export async function GET() {
  const started = Date.now();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
  try {
    await Promise.race([getDb().execute(sql`select 1`), timeout]);
    return Response.json({ ok: true, db: "up", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[health] database check failed:", err instanceof Error ? err.message : err);
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
