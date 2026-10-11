import { NextResponse, type NextRequest } from "next/server";
import { getPool } from "@/lib/data/pg-store";
import { whatsappConfig } from "@/lib/whatsapp-cloud";
import { handleWhatsAppWebhook, verifyWhatsAppSubscription } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";

const reply = ({ status, body }: { status: number; body: string | Record<string, unknown> }) =>
  typeof body === "string" ? new NextResponse(body, { status, headers: { "content-type": "text/plain" } }) : NextResponse.json(body, { status });

export async function GET(request: NextRequest) {
  return reply(verifyWhatsAppSubscription(whatsappConfig(), request.nextUrl.searchParams));
}

export async function POST(request: Request) {
  const cfg = whatsappConfig();
  if (!cfg || !process.env.DATABASE_URL) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  try {
    return reply(await handleWhatsAppWebhook(getPool(process.env.DATABASE_URL), cfg, await request.text(), request.headers.get("x-hub-signature-256")));
  } catch (error) {
    console.error("[whatsapp] webhook failed; Meta will retry", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
