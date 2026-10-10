import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";
import { handleCancel } from "@/lib/manage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let input: { reason?: unknown } = {};
  try {
    const text = await request.text();
    if (text) input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleCancel(store, token, input?.reason, new Date());
  return NextResponse.json(body, { status });
}
