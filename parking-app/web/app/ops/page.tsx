import type { Metadata } from "next";
import { OpsConsole } from "@/components/OpsConsole";

export const metadata: Metadata = { title: "Operator console", robots: { index: false } };

export default function OpsPage() {
  return (
    <div className="wrap">
      <header className="page-head"><h1>Operator console</h1><p>Live lot status, today&apos;s arrivals, rates, monthly passes and your weekly payouts.</p></header>
      <OpsConsole />
    </div>
  );
}
