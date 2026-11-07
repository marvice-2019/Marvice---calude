/**
 * Content-Security-Policy (brief §10). A fresh nonce per request plus
 * 'strict-dynamic': only Next.js's own scripts (and what they load, e.g. GA4
 * and the Meta Pixel after consent) run. Inline style attributes stay allowed
 * because React writes them.
 */
export function buildCsp(nonce: string, dev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://www.google-analytics.com", "https://www.googletagmanager.com", "https://www.facebook.com"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com", "https://www.facebook.com", "https://connect.facebook.net"],
    "frame-src": ["https://www.google.com", "https://challenges.cloudflare.com"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
