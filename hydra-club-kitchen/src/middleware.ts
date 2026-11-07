import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { buildCsp } from "@/lib/csp";

const { auth } = NextAuth(authConfig);

/**
 * Every page: a per-request CSP nonce (Next.js applies it to its own scripts).
 * /admin and /api/admin: the Auth.js gate from auth.config (sign-in redirect,
 * forced password change); every page and API handler re-checks against the DB.
 */
export default auth(async (req) => {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const verdict = authConfig.callbacks.authorized({ auth: req.auth, request: req });
    if (verdict === false) {
      const login = new URL("/admin/login", req.nextUrl);
      login.searchParams.set("callbackUrl", req.nextUrl.href);
      return NextResponse.redirect(login);
    }
    if (verdict instanceof Response) return verdict;
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
});

export const config = {
  // Everything except static assets, processed photos and generated metadata files.
  matcher: ["/((?!_next/static|_next/image|media/|icon\\.svg|opengraph-image|robots\\.txt|sitemap\\.xml).*)"],
};
