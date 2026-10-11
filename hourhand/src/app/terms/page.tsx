import type { Metadata } from "next";
import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = {
  title: "Terms · Hourhand",
  description: "The terms for using Hourhand: accounts, plans and billing, booking payments, acceptable use, liability and how to reach us.",
};

const h2 = "mt-10 font-display text-lg text-text";
const p = "mt-3 text-text";
const ul = "mt-3 list-disc space-y-2 pl-5 text-text";
const a = "text-accent underline underline-offset-4";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* Working draft under Indian law; have a lawyer review before public launch. */}
      <Link href="/" className="text-sm text-text-muted underline underline-offset-4">
        Hourhand home
      </Link>
      <main>
        <h1 className="mt-6 font-display text-xl text-text">Terms of service</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated 11 October 2026</p>

        <p className={p}>These terms are the agreement between you and us when you use Hourhand. By creating an account or booking through Hourhand, you agree to them.</p>

        <h2 className={h2}>Who we are</h2>
        <p className={p}>
          Hourhand is run by Marvice Media Private Limited, 37, Veeraragavapuram, Ekkadu Post, Tiruvallur, Tamil Nadu 602021, India (GSTIN 33AAMCM6642H1ZB). &ldquo;We&rdquo; and &ldquo;us&rdquo; mean that company.
        </p>

        <h2 className={h2}>Your account</h2>
        <ul className={ul}>
          <li>You must be 18 or older and give us a real email address you control.</li>
          <li>You are responsible for what happens under your account. Keep access to your email safe, because that is how you sign in.</li>
          <li>You own the content you add, such as event types and booking questions. You let us store and show it only to run the service.</li>
          <li>You can close your account at any time from Dashboard → Settings.</li>
        </ul>

        <h2 className={h2}>Plans and billing</h2>
        <ul className={ul}>
          <li>Hourhand has a Free plan and paid plans. Paid plans are billed in advance, monthly or yearly, as a Razorpay subscription.</li>
          <li>Prices are shown before GST. 18% GST is added at checkout.</li>
          <li>You can cancel any time from your plan page. Your plan continues to the end of the period you have paid for, and then does not renew.</li>
          <li>We do not refund part periods, unless the law requires it.</li>
          <li>We email you 7 days before each renewal. If we change a price, we tell you by email before it applies to your next renewal.</li>
          <li>If a renewal payment fails and is not fixed, your account moves to the Free plan.</li>
        </ul>

        <h2 className={h2}>Payments from your guests</h2>
        <p className={p}>
          On a paid plan you can charge guests when they book. Those payments go straight from the guest to your own Razorpay account. Hourhand is not a party to them: we do not hold the money, and we are not the seller. You are responsible for refunds, taxes, invoices and your own terms with your guests, and for following Razorpay&apos;s terms. When you cancel a paid booking, Hourhand asks Razorpay to refund the guest from your account.
        </p>

        <h2 className={h2}>Acceptable use</h2>
        <p className={p}>Do not use Hourhand to:</p>
        <ul className={ul}>
          <li>break the law, or collect data about people without a lawful reason;</li>
          <li>send spam, or mislead or harass guests;</li>
          <li>try to get into accounts or data that are not yours, or disrupt or overload the service;</li>
          <li>copy, resell or reverse engineer the service, except where the law allows it.</li>
        </ul>

        <h2 className={h2}>Availability</h2>
        <p className={p}>
          We work hard to keep Hourhand running, but we do not promise it will always be available or free of errors. Calendar providers such as Google can fail or change. When we can&apos;t check a calendar, we show it on the sync light and pause bookings for that host, so guests are not offered times we can&apos;t confirm. You should still keep an eye on your own calendar.
        </p>

        <h2 className={h2}>Limitation of liability</h2>
        <p className={p}>
          As far as the law allows, we are not liable for indirect or consequential losses, such as lost income or missed bookings. Our total liability for any claim relating to Hourhand is limited to the fees you paid us in the 12 months before the claim. Nothing in these terms limits liability that cannot be limited under Indian law.
        </p>

        <h2 className={h2}>Ending the agreement</h2>
        <p className={p}>
          You can stop using Hourhand and close your account at any time. We may suspend or close an account that breaks these terms or puts others at risk; where we can, we will tell you first and give you a chance to fix it. When an account is closed, its data is handled as our <Link href="/privacy" className={a}>privacy policy</Link> describes.
        </p>

        <h2 className={h2}>Changes to these terms</h2>
        <p className={p}>If we change these terms in a way that matters, we will email account holders before the change takes effect. If you keep using Hourhand after that, the new terms apply.</p>

        <h2 className={h2}>Law and courts</h2>
        <p className={p}>These terms are governed by the laws of India. The courts at Chennai, Tamil Nadu have exclusive jurisdiction over any dispute about them.</p>

        <h2 className={h2}>Contact</h2>
        <p className={p}>
          Yuvaraj G S, <a className={a} href="mailto:Yuvarajgs@marvice.in">Yuvarajgs@marvice.in</a>, +91 78456 67204.
        </p>
      </main>
      <footer className="mt-12 border-t border-border pt-6">
        <LegalLinks />
      </footer>
    </div>
  );
}
