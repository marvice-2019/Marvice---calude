import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiBase } from "@/lib/session";

// DEV ONLY: completes a payment on the API's fake gateway by sending it a correctly signed
// "payment.captured" webhook. Enabled only when DEV_FAKE_PAY=1 and a webhook secret is set.
// Never set DEV_FAKE_PAY in production; the deploy stage refuses to.
export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  // Never in production, even if DEV_FAKE_PAY is set by mistake (deploy/parking-app sets APP_ENV per environment).
  if (process.env.APP_ENV === "production" || process.env.DEV_FAKE_PAY !== "1" || !secret) return NextResponse.json({ error: "not_found", message: "Not found." }, { status: 404 });
  const { order_id, amount, outcome } = await req.json() as { order_id: string; amount: number; outcome?: "captured" | "failed" };
  if (!/^order_[a-f0-9]+$/.test(order_id ?? "")) return NextResponse.json({ error: "bad_order", message: "Unknown order." }, { status: 400 });
  const raw = JSON.stringify({ event: outcome === "failed" ? "payment.failed" : "payment.captured",
    payload: { payment: { entity: { id: "pay_dev_" + randomBytes(6).toString("hex"), order_id, amount, method: "upi", fee: 0 } } } });
  const res = await fetch(apiBase() + "/v1/webhooks/razorpay", { method: "POST", body: raw, headers: {
    "content-type": "application/json", "x-razorpay-event-id": "evt_dev_" + randomBytes(6).toString("hex"),
    "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex") } });
  return NextResponse.json(await res.json(), { status: res.status });
}
