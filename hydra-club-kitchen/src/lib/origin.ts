/**
 * CSRF defence for admin mutations: the browser's Origin header must match
 * the site. Session cookies are SameSite=Lax, so this is the second layer.
 * A missing Origin on a mutation is rejected (all current browsers send it).
 */
export function isSameOrigin(headers: Headers, siteUrl: string | undefined): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (siteUrl) return originUrl.origin === new URL(siteUrl).origin;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  return host !== null && originUrl.host === host;
}
