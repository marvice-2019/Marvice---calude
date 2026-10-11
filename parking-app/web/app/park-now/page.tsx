import type { Metadata } from "next";
import { ParkNow } from "@/components/ParkNow";

export const metadata: Metadata = { title: "Park now", description: "At the gate already? Enter the lot number from the entrance board, choose hours and pay by UPI.", alternates: { canonical: "/park-now" } };

export default function ParkNowPage() {
  return (
    <div className="wrap" style={{ maxWidth: 620 }}>
      <header className="page-head"><h1>Park now</h1><p>Type the number on the yellow board at the entrance. Pay, and your pass opens the gate.</p></header>
      <ParkNow />
    </div>
  );
}
