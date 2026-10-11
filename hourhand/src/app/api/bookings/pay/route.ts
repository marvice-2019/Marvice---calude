import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";
import { handleConfirmPayment } from "@/lib/payments/confirm-handler";
import { requestPaymentDeps } from "@/lib/payments/request-deps";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", fields: { body: "Send a JSON body." } }, { status: 400 });
  }
  const { status, body } = await handleConfirmPayment(store, requestPaymentDeps(), input, new Date(), { clientKey: clientIp(request.headers), limiter: rateLimiter });
  return NextResponse.json(body, { status });
}
