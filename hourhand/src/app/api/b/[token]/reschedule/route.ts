import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { store } from "@/lib/data";
import { handleReschedule } from "@/lib/manage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Token-gated, but still capped per address so nobody can hammer manage links.
  if (!rateLimiter.take(`reschedule:${clientIp(request.headers)}`, { max: 30, windowMs: 3_600_000 })) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleReschedule(store, token, input, new Date());
  return NextResponse.json(body, { status });
}
