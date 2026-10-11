import type { Metadata } from "next";
import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = {
  title: "Privacy · Hourhand",
  description: "What Hourhand collects from hosts and guests, why, who helps us process it, and how to see, correct or delete it.",
};

const h2 = "mt-10 font-display text-lg text-text";
const p = "mt-3 text-text";
const ul = "mt-3 list-disc space-y-2 pl-5 text-text";
const a = "text-accent underline underline-offset-4";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* Working draft under Indian law; have a lawyer review before public launch. */}
      <Link href="/" className="text-sm text-text-muted underline underline-offset-4">
        Hourhand home
      </Link>
      <main>
        <h1 className="mt-6 font-display text-xl text-text">Privacy policy</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated 11 October 2026</p>

        <p className={p}>
          This page explains what Hourhand collects, why, who helps us handle it, how long we keep it and what you can ask us to do with it. We have tried to write it in plain words. If anything is unclear, write to us and a person will answer.
        </p>

        <h2 className={h2}>Who we are</h2>
        <p className={p}>
          Hourhand is run by Marvice Media Private Limited, 37, Veeraragavapuram, Ekkadu Post, Tiruvallur, Tamil Nadu 602021, India (GSTIN 33AAMCM6642H1ZB). We decide how the personal data described here is used.
        </p>
        <p className={p}>
          Contact and grievance officer: Yuvaraj G S, <a className={a} href="mailto:Yuvarajgs@marvice.in">Yuvarajgs@marvice.in</a>, +91 78456 67204.
        </p>

        <h2 className={h2}>What we collect from hosts</h2>
        <p className={p}>A host is someone who signs up to take bookings.</p>
        <ul className={ul}>
          <li>Your name and email address, to create your account and sign you in.</li>
          <li>
            If you connect Google Calendar: the list of your calendars, and the times you are busy on the calendars you choose to check. We read when you are busy, not what your meetings are about.
          </li>
          <li>The calendar events Hourhand creates for your bookings, so we can move or delete them when a booking changes.</li>
          <li>If you take payments at booking: your own Razorpay key pair, which we seal with AES-256-GCM encryption before storing it.</li>
          <li>Your plan and billing status (which plan, when it renews, whether a payment went through). Card and UPI details stay with Razorpay; we never see them.</li>
          <li>The settings you choose: event types, availability, your booking link and time zone.</li>
        </ul>

        <h2 className={h2}>What we collect from guests</h2>
        <p className={p}>A guest is someone who books time with a host.</p>
        <ul className={ul}>
          <li>Your name and email address, and your phone number if the host asks for it.</li>
          <li>Your answers to any questions the host adds to the booking form.</li>
          <li>Your time zone, so times show correctly for you.</li>
        </ul>

        <h2 className={h2}>Why we use it</h2>
        <ul className={ul}>
          <li>To run the service you asked for: show free times, make bookings, put them in the host&apos;s calendar and create Google Meet links.</li>
          <li>To send the emails a booking needs: confirmations, reminders, reschedules and cancellations, and sign-in links.</li>
          <li>To tell a host when a calendar connection stops working, and to remind them 7 days before a plan renews.</li>
          <li>To take payment for Hourhand plans, and to pass guests&apos; booking payments to the host&apos;s own Razorpay account.</li>
          <li>To keep the service secure, stop abuse, and meet our legal and tax duties.</li>
        </ul>
        <p className={p}>We use personal data because you asked us to provide the service (or a host did, on your behalf), because the law requires it, or for the legitimate interest of keeping Hourhand safe and working.</p>

        <h2 className={h2}>Google user data</h2>
        <p className={p}>
          Hourhand&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a className={a} href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p className={p}>
          We use Google data only to sign you in, check when you are busy, and create, move or delete the events for your bookings. We never sell Google user data, never use it for advertising, and never use it to train AI models. People at Hourhand do not read it unless you ask us to help with a problem, or the law requires it.
        </p>

        <h2 className={h2}>Who processes it for us</h2>
        <ul className={ul}>
          <li>
            <strong>Resend</strong> sends our emails.
          </li>
          <li>
            <strong>Google</strong> provides sign-in with Google, Google Calendar and Google Meet.
          </li>
          <li>
            <strong>Razorpay</strong> takes payment for Hourhand plans. For booking payments, the guest pays into the host&apos;s own Razorpay account.
          </li>
          <li>
            <strong>Stripe</strong>, only if we offer card payments for customers outside India.
          </li>
          <li>
            <strong>Microsoft</strong>, only once a host connects an Outlook calendar, when that becomes available.
          </li>
          <li>
            <strong>Hosting:</strong> Hourhand runs on a server we rent and manage ourselves; we will name the provider and its country here before we leave beta.
          </li>
        </ul>
        <p className={p}>Some of these companies handle data outside India. We share only what each one needs to do its job. We do not sell personal data to anyone.</p>

        <h2 className={h2}>Cookies</h2>
        <p className={p}>
          We set one cookie: the sign-in session cookie that keeps a host signed in. On booking pages, your 12-hour or 24-hour clock choice is kept in your own browser. We use no analytics or advertising cookies, so there is no cookie banner.
        </p>

        <h2 className={h2}>How long we keep it</h2>
        <p className={p}>
          We keep your data while your account is open. You can delete your account at Dashboard → Settings. A closed account can be recovered for 30 days; after that it is permanently deleted with everything it owns, including event types, bookings, calendar connections and sealed keys. If a guest is still owed a refund, deletion waits until the refund has gone through. Records we must keep by law, such as tax invoices, are kept for as long as the law requires.
        </p>

        <h2 className={h2}>Your rights</h2>
        <p className={p}>
          Under India&apos;s Digital Personal Data Protection Act, 2023, and, if you are in the UK or the EU, under the UK GDPR or the GDPR, you can ask us to:
        </p>
        <ul className={ul}>
          <li>tell you what personal data we hold about you and give you a copy;</li>
          <li>correct data that is wrong or out of date;</li>
          <li>delete your data, where we don&apos;t need to keep it by law.</li>
        </ul>
        <p className={p}>
          Write to our grievance officer at <a className={a} href="mailto:Yuvarajgs@marvice.in">Yuvarajgs@marvice.in</a>. We will acknowledge your request within 3 working days and act on it within 30 days. If you are not happy with our answer, you can complain to the Data Protection Board of India, or, in the UK or EU, to your local data protection authority.
        </p>
        <p className={p}>If you booked with a host, the host decides what to ask you and keeps their own records of your booking. You can also contact them directly.</p>

        <h2 className={h2}>Security</h2>
        <p className={p}>
          Pages are served over HTTPS. Calendar tokens and Razorpay keys are encrypted with AES-256-GCM, so a copy of the database alone can&apos;t use them. Every host&apos;s records are checked against their account on each request, and sign-in uses one-time links that expire after 15 minutes. No system is perfectly safe; if a breach affects you, we will tell you and the authorities as the law requires.
        </p>

        <h2 className={h2}>Children</h2>
        <p className={p}>Hourhand is not for anyone under 18. We do not knowingly collect data from children. If you think a child has given us data, write to us and we will delete it.</p>

        <h2 className={h2}>Changes</h2>
        <p className={p}>If we change this policy in a way that matters, we will email hosts before the change takes effect and update the date at the top.</p>
      </main>
      <footer className="mt-12 border-t border-border pt-6">
        <LegalLinks />
      </footer>
    </div>
  );
}
