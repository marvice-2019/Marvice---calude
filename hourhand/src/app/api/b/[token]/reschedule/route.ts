import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";
import { handleReschedule } from "@/lib/manage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleReschedule(store, token, input, new Date());
  return NextResponse.json(body, { status });
}
