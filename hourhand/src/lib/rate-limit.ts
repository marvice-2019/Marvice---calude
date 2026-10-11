/**
 * Fixed-window rate limiting kept in this server process. Hourhand runs one web container, so in-memory counts are
 * enough; a second web replica would need these moved to Postgres.
 */
export type Limit = { max: number; windowMs: number };

type Window = { startedAt: number; count: number };

/** Memory bound: past this many keys the oldest are dropped, which can only make limits more lenient, never stricter. */
const MAX_KEYS = 50_000;
const SWEEP_EVERY_MS = 60_000;
const LONGEST_WINDOW_MS = 10 * 60_000;

export function createRateLimiter(now: () => number = Date.now) {
  const windows = new Map<string, Window>();
  let lastSweep = now();

  function sweep(t: number) {
    if (t - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = t;
      for (const [k, w] of windows) if (t - w.startedAt >= LONGEST_WINDOW_MS) windows.delete(k);
    }
  }

  function cap() {
    // Map keeps insertion order, so the first keys are the oldest windows.
    for (const k of windows.keys()) {
      if (windows.size <= MAX_KEYS) break;
      windows.delete(k);
    }
  }

  return {
    size: () => windows.size,
    /** Counts one attempt for `key`. Returns false (and does not count it) once `max` attempts are used in the window. */
    take(key: string, { max, windowMs }: Limit): boolean {
      const t = now();
      sweep(t);
      const w = windows.get(key);
      if (!w || t - w.startedAt >= windowMs) {
        windows.delete(key); // re-insert so map order stays oldest-first
        windows.set(key, { startedAt: t, count: 1 });
        cap();
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
 * New bookings send email to whatever address the form gives, so they are limited too: per guest email (stops one inbox
 * being flooded with confirmations) and per client address (stops one script booking for many addresses).
 */
export const BOOKING_LIMITS = {
  perEmail: { max: 5, windowMs: 60 * 60_000 },
  perIp: { max: 10, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;

/**
 * The client's address as our reverse proxy saw it. Coolify's Traefik appends the real address to x-forwarded-for,
 * so the rightmost entry is the trustworthy one; anything to its left was sent by the client and can be forged.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return addressKey(forwarded.at(-1) || headers.get("x-real-ip") || "unknown");
}

/** IPv6 addresses are grouped by their /64 prefix (one household or server gets a whole /64), IPv4 kept as is. */
export function addressKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
