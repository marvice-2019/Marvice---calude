import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/auth";
import { getSignedInUser } from "@/lib/auth/session";
import { calendarDeps, calendarRedirectUri } from "@/lib/calendar/env";
import { OAUTH_COOKIES, startOAuth } from "@/lib/calendar/oauth";

export const dynamic = "force-dynamic";

/** Sends the signed-in host to Microsoft to let Hourhand read their availability and add booked events. */
export async function GET(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const back = (error: string) => NextResponse.redirect(new URL(`/dashboard/calendars?error=${error}`, request.url));
  if (!authEnabled()) return back("demo");
  const deps = calendarDeps();
  const microsoft = deps?.providers.microsoft;
  if (!deps || !microsoft) return back("microsoft_not_configured");
  const s = startOAuth(deps.key, user.id, new Date(), "microsoft");
  const res = NextResponse.redirect(microsoft.authUrl({
    redirectUri: calendarRedirectUri(request.nextUrl.origin, process.env, "microsoft"), state: s.state, codeChallenge: s.codeChallenge, loginHint: user.email,
  }));
  res.cookies.set(OAUTH_COOKIES.microsoft.name, s.cookie, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: OAUTH_COOKIES.microsoft.path, maxAge: 600,
  });
  return res;
}
