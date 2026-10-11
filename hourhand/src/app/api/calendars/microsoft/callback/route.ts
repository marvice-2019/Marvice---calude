import { NextResponse, type NextRequest } from "next/server";
import { getSignedInUser } from "@/lib/auth/session";
import { saveConnection } from "@/lib/calendar/connections";
import { calendarDeps, calendarRedirectUri } from "@/lib/calendar/env";
import { checkOAuthCallback, OAUTH_COOKIES } from "@/lib/calendar/oauth";
import { getPool } from "@/lib/data/pg-store";
import { kickJobs } from "@/lib/jobs/kick";

export const dynamic = "force-dynamic";

/** Microsoft sends the host back here. Only the host who started the handshake, with its state, can finish it. */
export async function GET(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard/calendars?${query}`, request.url));
    res.cookies.set(OAUTH_COOKIES.microsoft.name, "", { path: OAUTH_COOKIES.microsoft.path, maxAge: 0 });
    return res;
  };
  const deps = calendarDeps();
  const microsoft = deps?.providers.microsoft;
  if (!deps || !microsoft) return done("error=microsoft_not_configured");

  const params = request.nextUrl.searchParams;
  const check = checkOAuthCallback(deps.key, request.cookies.get(OAUTH_COOKIES.microsoft.name)?.value, params.get("state"), user.id, new Date(), "microsoft");
  if (!check.ok) return done(`error=${check.error}`);
  if (params.get("error")) return done("error=microsoft_denied");
  const code = params.get("code");
  if (!code) return done("error=microsoft_denied");

  try {
    const tokens = await microsoft.exchangeCode({ code, redirectUri: calendarRedirectUri(request.nextUrl.origin, process.env, "microsoft"), codeVerifier: check.verifier });
    if (microsoft.missingScopes(tokens.scope).length > 0) {
      await microsoft.revoke(tokens.refreshToken ?? tokens.accessToken);
      return done("error=microsoft_missing_permissions");
    }
    const calendars = await microsoft.listCalendars(tokens.accessToken);
    await saveConnection(getPool(process.env.DATABASE_URL as string), deps.key, user.id, "microsoft", tokens, calendars, new Date());
    kickJobs(); // the first sync runs straight away instead of waiting for the next poll
    return done("connected=1");
  } catch (error) {
    console.error("[calendar] connecting Outlook failed", (error as Error).message);
    return done("error=microsoft");
  }
}
