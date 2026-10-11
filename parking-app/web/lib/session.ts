import { cookies } from "next/headers";

// Tokens live only in httpOnly cookies set by our own route handlers; page JavaScript never sees them.
export const ACCESS = "bl_access", REFRESH = "bl_refresh";
const secure = process.env.NODE_ENV === "production";

export const apiBase = () => process.env.API_URL ?? "http://localhost:3000";

export async function setSession(access: string, refresh: string) {
  const c = await cookies();
  c.set(ACCESS, access, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 15 * 60 });
  c.set(REFRESH, refresh, { httpOnly: true, sameSite: "strict", secure, path: "/api", maxAge: 30 * 86_400 });
}

export async function clearSession() {
  const c = await cookies();
  c.delete(ACCESS);
  c.set(REFRESH, "", { httpOnly: true, path: "/api", maxAge: 0 });
}

/** Swap the refresh cookie for a new pair. Returns the new access token or null. */
export async function refreshSession(): Promise<string | null> {
  const c = await cookies();
  const refresh = c.get(REFRESH)?.value;
  if (!refresh) return null;
  const res = await fetch(apiBase() + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh }) });
  if (!res.ok) { await clearSession(); return null; }
  const body = await res.json() as { access: string; refresh: string };
  await setSession(body.access, body.refresh);
  return body.access;
}
