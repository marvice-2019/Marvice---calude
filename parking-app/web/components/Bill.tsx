import type { Quote } from "@/lib/contract";
import { inr } from "@/lib/format";

/** The bill exactly as the API priced it (SPEC §6). Nothing is recomputed in the browser. */
export function Bill({ q }: { q: Quote }) {
  const capped = q.basePaise < q.hours * q.ratePaise;
  return (
    <div className="bill num" data-testid="bill">
      <div><span>Parking · {q.hours} h at {inr(q.ratePaise)}/hr{capped ? " (daily cap applied)" : ""}</span><span>{inr(q.basePaise)}</span></div>
      {q.discountPaise > 0 && <div style={{ color: "var(--ok)" }}><span>Promo {q.promoCode}</span><span>−{inr(q.discountPaise)}</span></div>}
      <div><span>Platform fee</span><span>{inr(q.feePaise)}</span></div>
      <div><span>GST 18%</span><span>{inr(q.gstPaise)}</span></div>
      <div className="tot"><span>Total</span><span data-testid="total">{inr(q.totalPaise)}</span></div>
    </div>
  );
}
