import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/auth";
import { store } from "@/lib/data";
import { getPool } from "@/lib/data/pg-store";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { handleJoinWaitlist } from "@/lib/waitlist-handler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const pool = authEnabled() ? getPool(process.env.DATABASE_URL!) : null;
  const { status, body } = await handleJoinWaitlist(pool, store, input, new Date(), { clientKey: clientIp(request.headers), limiter: rateLimiter });
  return NextResponse.json(body, { status });
}
