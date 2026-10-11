"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { GatewayOrder, PayMethod } from "@/lib/contract";
import { inr } from "@/lib/format";

export type GatewayResult = "success" | "failed" | "cancelled";

// The API's dev/test gateway issues this key. No real money moves, so the web shows a stand-in
// checkout instead of Razorpay. The payment is confirmed only when the API receives a signed
// webhook, exactly as in production; the pass page waits for that.
export const FAKE_KEY = "rzp_test_fake";

type RazorpayCtor = new (o: Record<string, unknown>) => { open(): void; on(ev: string, f: () => void): void };
declare global { interface Window { Razorpay?: RazorpayCtor } }

/** Opens checkout for an API-created order. Loads Razorpay's script only here, only when needed. */
export function Gateway({ order, contact, method, description, onResult }: {
  order: GatewayOrder; contact: string; method: PayMethod; description: string; onResult: (r: GatewayResult) => void;
}) {
  const [ready, setReady] = useState(false);
  const opened = useRef(false);
  const fake = order.key_id === FAKE_KEY;

  useEffect(() => {
    if (fake || !ready || opened.current || !window.Razorpay) return;
    opened.current = true;
    // Razorpay keeps its modal open after a failed attempt and lets the user retry, so a failure
    // is not final: settle only on success (handler) or when the modal closes (ondismiss).
    let settled = false, failedAttempt = false;
    const done = (r: GatewayResult) => { if (!settled) { settled = true; onResult(r); } };
    const rzp = new window.Razorpay({
      key: order.key_id, order_id: order.id, amount: order.amount, currency: order.currency,
      name: "Bayline", description,
      prefill: { contact: "+91" + contact, method },
      theme: { color: "#1446A0" },
      handler: () => done("success"),
      modal: { ondismiss: () => done(failedAttempt ? "failed" : "cancelled"), confirm_close: true }
    });
    rzp.on("payment.failed", () => { failedAttempt = true; });
    rzp.open();
  }, [fake, ready, order, contact, method, description, onResult]);

  if (fake) {
    return (
      <>
        <div className="scrim" />
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="gw-title" data-order-id={order.id} data-amount={order.amount}>
          <span className="tag" style={{ color: "var(--warn)", justifySelf: "start" }}>Test payment</span>
          <h2 id="gw-title" style={{ margin: 0 }}>Pay {inr(order.amount)}</h2>
          <p style={{ margin: 0, color: "var(--muted)" }}>This server runs without Razorpay keys, so no money moves. Pick an outcome to test the flow.</p>
          <button className="btn" type="button" autoFocus onClick={() => onResult("success")}>Pay {inr(order.amount)}</button>
          <button className="btn ghost" type="button" onClick={() => onResult("failed")}>Simulate a failed payment</button>
          <button className="btn ghost" type="button" onClick={() => onResult("cancelled")}>Cancel</button>
        </div>
      </>
    );
  }
  return <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onReady={() => setReady(true)}
    onError={() => onResult("failed")} />;
}
