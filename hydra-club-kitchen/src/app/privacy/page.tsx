import type { Metadata } from "next";
import { LegalPage } from "@/components/content/SubpageShell";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Hydra Club & Kitchen uses the details you give when you book a table.",
  alternates: { canonical: "/privacy" },
};

/*
  WORKING DRAFT under the Digital Personal Data Protection Act 2023 and the IT Act 2000.
  To be reviewed by a lawyer before launch. Open items for the client:
  1. Legal entity that operates Hydra Club & Kitchen (the Data Fiduciary) and its registered address.
  2. Name and contact of the grievance officer (DPDP Act s.8(10), IT Rules 2011 r.5(9)).
  3. Analytics/advertising tools actually enabled at launch (stage 6 consent banner).
*/
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="7 November 2026">
      <p>
        This page explains what Hydra Club &amp; Kitchen (&quot;Hydra&quot;, &quot;we&quot;) collects when you use this website, why, and what you can
        ask us to do with it. We collect as little as we need to hold your table.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>When you book: your name, mobile number, the night, time, table and number of guests, and any notes you add.</li>
        <li>Your agreement that we may contact you about the booking, and when you gave it.</li>
        <li>Campaign tags in the link you arrived from (for example utm_source or gclid), so we know which ads and posts bring guests.</li>
        <li>Your IP address, kept briefly to stop automated or repeated booking attempts.</li>
        <li>Analytics and advertising cookies only if you accept them in the cookie banner.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To hold, confirm, change or cancel your table, and to recognise you at the door.</li>
        <li>To message or call you about that booking, including on WhatsApp.</li>
        <li>To keep the booking system safe from spam and abuse.</li>
        <li>To understand, in aggregate, how people find us.</li>
      </ul>
      <p>We do not sell your details, and we do not send marketing messages unless you separately agree to them.</p>

      <h2>Who else sees it</h2>
      <p>
        Our hosts and managers see bookings in our staff system. Booking details pass through our automation and messaging providers (including
        WhatsApp) only to send booking messages to you and to our team. Our hosting provider stores the data on our behalf. We share data with
        authorities only where the law requires it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Booking records are deleted 12 months after the night of the booking, unless the law requires us to keep them longer. IP addresses used
        for spam protection are deleted after a day.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the personal data we hold about you, to correct or complete it, to have it erased, or to withdraw your consent to be
        contacted. Withdrawing consent may mean we can&apos;t hold a booking. You can also nominate someone to exercise these rights for you.
      </p>
      <p>
        To make a request or raise a complaint, message us on{" "}
        <a href="https://www.instagram.com/hydraclubkitchen/" target="_blank" rel="noopener noreferrer">
          Instagram
        </a>{" "}
        with your booking reference. We reply within 30 days. If you are not satisfied, you can complain to the Data Protection Board of India.
      </p>

      <h2>Changes</h2>
      <p>If we change how we use your data, we will update this page and the date above.</p>
    </LegalPage>
  );
}
