import { NextResponse, type NextRequest } from "next/server";
import { getSignedInUser } from "@/lib/auth/session";
import { saveConnection } from "@/lib/calendar/connections";
import { calendarDeps, calendarRedirectUri } from "@/lib/calendar/env";
import { checkOAuthCallback, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/lib/calendar/oauth";
import { getPool } from "@/lib/data/pg-store";
import { kickJobs } from "@/lib/jobs/kick";

export const dynamic = "force-dynamic";

/** Google sends the host back here. Only the host who started the handshake, with its state, can finish it. */
export async function GET(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard/calendars?${query}`, request.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const deps = calendarDeps();
  const google = deps?.providers.google;
  if (!deps || !google) return done("error=not_configured");

  const params = request.nextUrl.searchParams;
  const check = checkOAuthCallback(deps.key, request.cookies.get(OAUTH_COOKIE)?.value, params.get("state"), user.id);
  if (!check.ok) return done(`error=${check.error}`);
  if (params.get("error")) return done("error=denied");
  const code = params.get("code");
  if (!code) return done("error=denied");

  try {
    const tokens = await google.exchangeCode({ code, redirectUri: calendarRedirectUri(request.nextUrl.origin), codeVerifier: check.verifier });
    if (google.missingScopes(tokens.scope).length > 0) {
      await google.revoke(tokens.refreshToken ?? tokens.accessToken);
      return done("error=missing_permissions");
    }
    const calendars = await google.listCalendars(tokens.accessToken);
    await saveConnection(getPool(process.env.DATABASE_URL as string), deps.key, user.id, "google", tokens, calendars, new Date());
    kickJobs(); // the first sync runs straight away instead of waiting for the next poll
    return done("connected=1");
  } catch (error) {
    console.error("[calendar] connecting Google Calendar failed", (error as Error).message);
    return done("error=google");
  }
}
