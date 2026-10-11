import type { Metadata } from "next";
import { Valet } from "@/components/Valet";

export const metadata: Metadata = { title: "Valet", description: "Valet with a live tracker: request your car from your phone, see it coming, pay the fee with GST, tip by UPI.", alternates: { canonical: "/valet" } };

export default function ValetPage() {
  return (
    <div className="wrap">
      <header className="page-head"><h1>Valet</h1><p>Hand over your keys, walk away. Request your car when you&apos;re ready and watch it come to the porch.</p></header>
      <Valet />
    </div>
  );
}
