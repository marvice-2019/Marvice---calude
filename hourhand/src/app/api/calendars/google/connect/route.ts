import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/auth";
import { getSignedInUser } from "@/lib/auth/session";
import { calendarDeps, calendarRedirectUri } from "@/lib/calendar/env";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, startOAuth } from "@/lib/calendar/oauth";

export const dynamic = "force-dynamic";

/** Sends the signed-in host to Google to let Hourhand read their availability and add booked events. */
export async function GET(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const back = (error: string) => NextResponse.redirect(new URL(`/dashboard/calendars?error=${error}`, request.url));
  if (!authEnabled()) return back("demo");
  const deps = calendarDeps();
  if (!deps) return back("not_configured");
  const s = startOAuth(deps.key, user.id);
  const res = NextResponse.redirect(deps.google.authUrl({
    redirectUri: calendarRedirectUri(request.nextUrl.origin), state: s.state, codeChallenge: s.codeChallenge, loginHint: user.email,
  }));
  res.cookies.set(OAUTH_COOKIE, s.cookie, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: OAUTH_COOKIE_PATH, maxAge: 600,
  });
  return res;
}
