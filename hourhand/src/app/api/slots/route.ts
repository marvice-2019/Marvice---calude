import { NextResponse, type NextRequest } from "next/server";
import { handleGetSlots } from "@/lib/booking";
import { store } from "@/lib/data";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Working out slots is the most expensive public read; a guest flipping through months stays far below this.
  if (!rateLimiter.take(`slots:${clientIp(request.headers)}`, { max: 120, windowMs: 60_000 })) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  const { status, body } = await handleGetSlots(store, request.nextUrl.searchParams, new Date());
  return NextResponse.json(body, { status });
}
