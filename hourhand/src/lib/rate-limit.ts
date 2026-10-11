/**
 * Fixed-window rate limiting kept in this server process. Hourhand runs one web container, so in-memory counts are
 * enough; a second web replica would need these moved to Postgres.
 */
export type Limit = { max: number; windowMs: number };

type Window = { startedAt: number; count: number };

export function createRateLimiter(now: () => number = Date.now) {
  const windows = new Map<string, Window>();

  return {
    /** Counts one attempt for `key`. Returns false (and does not count it) once `max` attempts are used in the window. */
    take(key: string, { max, windowMs }: Limit): boolean {
      const t = now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (t - w.startedAt >= windowMs) windows.delete(k);
      const w = windows.get(key);
      if (!w || t - w.startedAt >= windowMs) {
        windows.set(key, { startedAt: t, count: 1 });
        return true;
      }
      if (w.count >= max) return false;
      w.count += 1;
      return true;
    },
  };
}

const shared = globalThis as typeof globalThis & { __hourhandRateLimiter?: ReturnType<typeof createRateLimiter> };

/** The one limiter for this server process. */
export const rateLimiter = (shared.__hourhandRateLimiter ??= createRateLimiter());

/** Sign-in links: a few per email (stops someone flooding one inbox) and more per IP (stops sweeping many addresses). */
export const SIGN_IN_LIMITS = {
  perEmail: { max: 3, windowMs: 10 * 60_000 },
  perIp: { max: 10, windowMs: 10 * 60_000 },
} satisfies Record<string, Limit>;

/**
 * The client's address as our reverse proxy saw it. Coolify's Traefik appends the real address to x-forwarded-for,
 * so the rightmost entry is the trustworthy one; anything to its left was sent by the client and can be forged.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return forwarded.at(-1) || headers.get("x-real-ip") || "unknown";
}
