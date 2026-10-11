import type { Metadata } from "next";
import { Monthly } from "@/components/Monthly";

export const metadata: Metadata = { title: "Monthly parking", description: "A reserved bay near work or home, billed monthly with GST. Due by the 5th; no paper passes.", alternates: { canonical: "/monthly" } };

export default function MonthlyPage() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <header className="page-head"><h1>Monthly parking</h1><p>One bay, every working day. The operator confirms within a working day; you pay by UPI and get a GST invoice each month.</p></header>
      <Monthly />
      <div className="card panel" style={{ marginTop: 18 }}>
        <strong>How billing works</strong>
        <div className="list-row"><span className="muted">Bill date</span><span>1st of each month</span></div>
        <div className="list-row"><span className="muted">Pay by</span><span>The 5th</span></div>
        <div className="list-row"><span className="muted">If unpaid</span><span>Gate entry pauses after the 7th</span></div>
        <div className="list-row"><span className="muted">Cancel</span><span>Any time, effective next month</span></div>
      </div>
    </div>
  );
}
