import type { Metadata } from "next";
import { LegalPage } from "@/components/content/SubpageShell";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for table bookings and visits at Hydra Club & Kitchen, Koramangala, Bengaluru.",
  alternates: { canonical: "/terms" },
};

/*
  WORKING DRAFT under Indian law (Indian Contract Act 1872, Consumer Protection Act 2019).
  To be reviewed by a lawyer before launch. Open items for the client: operating legal entity,
  age-entry policy, dress code, cover charge or minimum spend for VIP/VVIP (unconfirmed),
  how long a table is held after the booked time, and the governing courts.
*/
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="7 November 2026">
      <p>These terms cover booking a table on this website and visiting Hydra Club &amp; Kitchen. By booking, you agree to them.</p>

      <h2>Booking a table</h2>
      <ul>
        <li>A booking made online is a request until our team confirms it. You will get a reference starting with HYD.</li>
        <li>A booking is for the table, night, time and number of guests you chose. Tell us early if any of that changes.</li>
        <li>Bookings are held for the booked time slot. If you are running late, message us so we can try to hold the table.</li>
        <li>We may move you to a comparable table if we have to, and will tell you if we do.</li>
      </ul>

      <h2>Changing or cancelling</h2>
      <p>
        You can cancel an upcoming booking yourself with your reference and the last four digits of your mobile number, or by messaging us. Please
        cancel as early as you can so someone else can have the table.
      </p>

      <h2>At the venue</h2>
      <ul>
        <li>Entry, age checks, dress code and house rules are at the discretion of the venue and the law.</li>
        <li>Alcohol is served only to guests of legal drinking age under Karnataka law. Carry valid photo ID.</li>
        <li>Prices, menus, events and line-ups can change without notice.</li>
      </ul>

      <h2>VIP, VVIP and Mezzanine</h2>
      <p>Any minimum spend or package for these areas is confirmed by our team before your visit. Nothing is charged through this website.</p>

      <h2>Your data</h2>
      <p>
        How we use your details is explained in our <a href="/privacy">privacy notice</a>.
      </p>

      <h2>Liability</h2>
      <p>
        We take care to keep the website and booking system working, but a booking can occasionally fail or be duplicated. Our liability for a
        booking is limited to arranging another table or cancelling the booking. Nothing here limits rights you have under consumer law.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of India. Courts in Bengaluru have jurisdiction.</p>
    </LegalPage>
  );
}
