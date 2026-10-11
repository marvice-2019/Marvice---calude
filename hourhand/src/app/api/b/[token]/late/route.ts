import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";
import { handleRunningLate } from "@/lib/manage";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Each tap emails the host: a few per address per hour is plenty for someone stuck in traffic.
  if (!rateLimiter.take(`late:${clientIp(request.headers)}`, { max: 10, windowMs: 3_600_000 })) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  let input: unknown = null;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleRunningLate(store, token, input, new Date());
  return NextResponse.json(body, { status });
}
