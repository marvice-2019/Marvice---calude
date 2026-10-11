import { NextResponse } from "next/server";
import { apiBase, clearSession, setSession } from "@/lib/session";

// POST /api/auth/otp | verify | logout. Verify stores tokens in httpOnly cookies and returns only the user.
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action === "logout") { await clearSession(); return NextResponse.json({ ok: true }); }
  if (action !== "otp" && action !== "verify") return NextResponse.json({ error: "not_found", message: "Not found." }, { status: 404 });
  const body = await req.text();
  const res = await fetch(`${apiBase()}/v1/auth/${action}`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" }, body
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  if (action === "verify") {
    await setSession(data.access, data.refresh);
    return NextResponse.json({ user: data.user });
  }
  return NextResponse.json(data);
}
