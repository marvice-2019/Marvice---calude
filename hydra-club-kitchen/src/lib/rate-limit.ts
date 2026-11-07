import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Sliding-window limiter in Postgres. Counts and records one hit for `key`
 * atomically (a per-key advisory lock serialises concurrent callers), so
 * N parallel requests can never all slip under the limit.
 */
export async function consume(db: Db, key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    await tx.execute(
      sql`delete from rate_limit_hits where key = ${key} and at < now() - make_interval(secs => ${windowSec})`,
    );
    const rows = await tx.execute<{ n: number; oldest: string | null }>(
      sql`select count(*)::int as n, min(at)::text as oldest from rate_limit_hits where key = ${key}`,
    );
    const { n, oldest } = rows[0]!;
    if (n >= limit) {
      const retryAfterMs = new Date(oldest!).getTime() + windowSec * 1000 - Date.now();
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    await tx.execute(sql`insert into rate_limit_hits (key) values (${key})`);
    // Opportunistic cleanup of other keys' expired rows (cheap, indexed on at).
    if (Math.random() < 0.02) await tx.execute(sql`delete from rate_limit_hits where at < now() - interval '1 day'`);
    return { ok: true };
  });
}

/**
 * Client IP behind Coolify's Traefik proxy. X-Real-IP is set by the proxy;
 * otherwise the right-most X-Forwarded-For entry is the one the proxy appended
 * (left-most entries are client-controlled and spoofable).
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = headers.get("x-forwarded-for");
  const last = xff
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  return last ?? "unknown";
}
