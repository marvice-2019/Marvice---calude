import { receiveWebhook } from "@/lib/billing/webhook-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return receiveWebhook("stripe", request);
}
