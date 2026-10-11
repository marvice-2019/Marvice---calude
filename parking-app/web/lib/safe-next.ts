/**
 * Return target after sign-in: only a path on this site. Resolving against our own origin catches
 * tricks like "/\evil.com" or "/\t/evil.com", which browsers normalise to "//evil.com".
 */
export function safeNext(next: string | null | undefined, origin: string, fallback = "/passes"): string {
  if (!next) return fallback;
  try {
    const u = new URL(next, origin);
    return u.origin === origin ? u.pathname + u.search + u.hash : fallback;
  } catch { return fallback; }
}
