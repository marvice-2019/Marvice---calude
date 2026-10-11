import type { Metadata } from "next";
import { OwnerLead } from "@/components/OwnerLead";

export const metadata: Metadata = {
  title: "List your parking space",
  description: "Own a basement, a plot or a building with spare bays in Bengaluru? Earn from it with prepaid bookings, a weekly payout and a GST-ready statement.",
  alternates: { canonical: "/list-your-space" }
};

export default function ListYourSpace() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 60 }}>
        <div className="trails" aria-hidden><i /><i /><i /><i /></div>
        <div className="wrap">
          <p className="eyebrow">For owners and operators</p>
          <h1>Empty bays <em>earn</em> nothing.</h1>
          <p className="lede">Drivers prepay before they arrive. You get a weekly payout with commission and TDS shown line by line.</p>
        </div>
      </section>
      <div className="wrap grid2" style={{ marginTop: 28 }}>
        <div className="card panel">
          <strong>What you get</strong>
          <div className="list-row"><span>Prepaid bookings</span><span className="muted">No cash at the gate</span></div>
          <div className="list-row"><span>Your rates, your hours</span><span className="muted">Change them any time</span></div>
          <div className="list-row"><span>Weekly payout</span><span className="muted">Commission and TDS itemised</span></div>
          <div className="list-row"><span>Valet desk option</span><span className="muted">Staff app included</span></div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Commission and payout terms are confirmed in your agreement before you go live.</p>
        </div>
        <OwnerLead />
      </div>
    </>
  );
}
