import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS, apiBase, refreshSession } from "@/lib/session";

// Same-origin proxy to the API under /v1. Adds the bearer token from the httpOnly cookie and refreshes once on 401.
const ALLOWED = /^v1\/(lots|quotes|bookings|me|valet|destinations|monthly-passes|uploads|leads)(\/|$)/;

async function forward(req: Request, path: string, token: string | undefined) {
  const url = new URL(req.url);
  const headers: Record<string, string> = { "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" };
  const ct = req.headers.get("content-type"), idem = req.headers.get("idempotency-key");
  if (ct) headers["content-type"] = ct;
  if (idem) headers["idempotency-key"] = idem;
  if (token) headers.authorization = `Bearer ${token}`;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().text();
  return fetch(`${apiBase()}/${path}${url.search}`, { method: req.method, headers, body, cache: "no-store" });
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!ALLOWED.test(path)) return NextResponse.json({ error: "not_found", message: "Not found." }, { status: 404 });
  const jar = await cookies();
  let res = await forward(req, path, jar.get(ACCESS)?.value);
  if (res.status === 401) {
    const fresh = await refreshSession();
    if (fresh) res = await forward(req, path, fresh);
  }
  const text = await res.text();
  return new NextResponse(text || null, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
