import type { Metadata } from "next";
import { Suspense } from "react";
import { Passes } from "@/components/Passes";

export const metadata: Metadata = { title: "Your passes", robots: { index: false } };

export default function PassesPage() {
  return (
    <div className="wrap">
      <header className="page-head"><h1>Your passes</h1><p>Show the QR at the gate. Passes stay on this device, so they open even with no signal.</p></header>
      <Suspense fallback={<div className="skel" />}><Passes /></Suspense>
    </div>
  );
}
