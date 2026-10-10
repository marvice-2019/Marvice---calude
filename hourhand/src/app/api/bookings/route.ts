import { NextResponse, type NextRequest } from "next/server";
import { handleCreateBooking } from "@/lib/booking";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleCreateBooking(store, input, new Date());
  return NextResponse.json(body, { status });
}
