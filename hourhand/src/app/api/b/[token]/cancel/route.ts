import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { store } from "@/lib/data";
import { handleCancel } from "@/lib/manage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Token-gated, but still capped per address so nobody can hammer manage links.
  if (!rateLimiter.take(`cancel:${clientIp(request.headers)}`, { max: 30, windowMs: 3_600_000 })) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  let input: { reason?: unknown; laterWeeks?: unknown } = {};
  try {
    const text = await request.text();
    if (text) input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleCancel(store, token, input?.reason, new Date(), { laterWeeks: input?.laterWeeks === true });
  return NextResponse.json(body, { status });
}
