import { NextResponse } from "next/server";
import { handlePing } from "@/lib/calendar/push";
import { getPool } from "@/lib/data/pg-store";

export const dynamic = "force-dynamic";

/**
 * Google's change pings for watched calendars. The answer is the same whether or not the ping matched a channel, so
 * the endpoint reveals nothing; a database error answers 500 so Google retries.
 */
export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return new NextResponse(null, { status: 204 });
  try {
    await handlePing(getPool(process.env.DATABASE_URL), {
      channelId: request.headers.get("x-goog-channel-id"),
      token: request.headers.get("x-goog-channel-token"),
      state: request.headers.get("x-goog-resource-state"),
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[calendar] change ping failed", error);
    return new NextResponse(null, { status: 500 });
  }
}
