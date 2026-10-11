import type { Metadata } from "next";
import { OwnerCalc } from "./OwnerCalc";

export const metadata: Metadata = {
  title: "Earn from empty parking bays",
  description: "Offices, apartments, malls and hospitals in Bengaluru list idle bays by the hour or month. See your estimated payout.",
  alternates: { canonical: "/list-your-space" }
};

export default function OwnersPage() {
  return (
    <section>
      <div className="intro"><h1>Earn from empty bays</h1><p>Offices, apartments, malls and hospitals list idle bays by the hour or month. You set the price and the hours; we send the drivers.</p></div>
      <OwnerCalc />
    </section>
  );
}
