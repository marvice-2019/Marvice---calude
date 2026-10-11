import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LegalLinks } from "@/components/LegalLinks";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { getSignedInUser } from "@/lib/auth/session";

// The data mode is read at request time; a build made in memory mode must not prerender away the signed-in redirect.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hourhand: a booking link that checks your calendar",
  description:
    "One booking link for coaches, tutors and therapists. Hourhand checks your Google Calendar, shows a sync light for each calendar, and a person answers support.",
};

const comingSoon = (
  <span className="ml-2 inline-block rounded-pill bg-warning-bg px-2 py-1 align-middle text-xs text-warning">Coming soon</span>
);

const steps = [
  { title: "Connect your calendar", body: "Google, Outlook or iCloud: pick the calendars to check. Each one gets its own sync light." },
  { title: "Share your link", body: "Put it in your bio, your messages or your site. Guests see only the times you're free, in their own time zone." },
  { title: "Show up", body: "The booking lands in your calendar with a Google Meet link, and your guest gets a confirmation and reminders." },
];

const features = [
  {
    title: "A sync light for every calendar",
    body: "Each Google calendar shows when it last synced. If we can't check a calendar, your booking page stops offering times, so nobody books over a meeting. If the connection drops, we email you.",
  },
  { title: "A person, not a bot", body: "Write to support and a person answers within one working day, on every plan." },
  { title: "Cancel in one tap", body: "We email you 7 days before each renewal. Cancel from your plan page and keep access to the end of what you paid for." },
  { title: "No time zone guesswork", body: "Guests see times in their own zone, and can switch between 12-hour and 24-hour clocks." },
  { title: "Emails that do the chasing", body: "Confirmation, reminder, reschedule and cancellation emails, each with a calendar file your guest can add in one click." },
  { title: "Paid sessions", body: "On Solo and Duo, take payment at booking through your own Razorpay account. The money goes straight to you." },
];

const plans = [
  {
    name: "Free",
    for: "For trying it, or a light schedule",
    price: "₹0",
    note: null,
    items: ["2 calendars checked for conflicts", "Booking emails with calendar files", "Google Meet links", "A small “Booked with Hourhand” line on your page"],
    recommended: false,
  },
  {
    name: "Solo",
    for: "For a coach, tutor or therapist",
    price: "₹399",
    note: "+ 18% GST, or ₹3,990 a year",
    items: ["Every calendar you want checked", "Payment at booking through your Razorpay account", "No Hourhand line on your page"],
    recommended: true,
  },
  {
    name: "Duo",
    for: "For you and an assistant",
    price: "₹599",
    note: "+ 18% GST, or ₹5,990 a year",
    items: ["Everything in Solo", "A second person at no extra cost: an assistant who runs your bookings, or a co-host with their own page"],
    recommended: false,
  },
];

const faqs = [
  {
    q: "What happens if my calendar stops syncing?",
    a: "The sync light shows it, your booking page stops offering times until we can check again, and we email you a link to reconnect. Nobody can book a time we can't check.",
  },
  { q: "Which calendars work?", a: "Google Calendar, Outlook, Office 365 and iCloud." },
  { q: "Do you send WhatsApp reminders?", a: "Emails go out on their own. For WhatsApp, one tap on a booking opens a ready confirmation or reminder to send from your own number; sending automatically is coming later." },
  { q: "How do I cancel?", a: "Dashboard, then Plan, then Cancel. You keep your plan until the end of the period you've paid for." },
  { q: "Who answers support?", a: "A person, within one working day." },
  { q: "Is GST included?", a: "No. Prices are shown before GST, and 18% GST is added at checkout." },
];

const sectionClass = "border-t border-border py-12 md:py-16";
const sectionTitle = "mb-6 font-display text-xl text-text";

export default async function Home() {
  // In memory mode there are no accounts (the dashboard opens as the demo host), so everyone sees the landing page.
  if (authEnabled() && (await getSignedInUser())) redirect("/dashboard/event-types");

  return (
    <div className="mx-auto max-w-(--hh-content-max) px-4">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="flex items-center gap-3 rounded-sm font-display text-lg text-text" aria-label="Hourhand home">
          <span aria-hidden className="relative size-7 rounded-pill bg-accent">
            <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-highlight" />
          </span>
          hourhand
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <a href="#pricing" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            Pricing
          </a>
          <Link href="/sign-in" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        <section className="grid items-center gap-10 py-10 md:grid-cols-2 md:py-16" aria-labelledby="hero-title">
          <div>
            <h1 id="hero-title" className="font-display text-display text-text">
              Your booking link, kept in sync. And a person when it isn&apos;t.
            </h1>
            <p className="mt-4 text-lg font-normal text-text-muted">
              One link for coaches, tutors and therapists. It offers only the times your calendar says you&apos;re free, and a real person answers if anything goes wrong.
            </p>
            <Link href="/sign-in" className={`${buttonClasses({ size: "lg" })} mt-6`}>
              Start free
            </Link>
            <p className="mt-3 text-sm text-text-muted">Free for one person. No card needed.</p>
          </div>
          <Card className="shadow-pop" role="img" aria-label="Example booking page with a green sync light and open times">
            <p className="text-lg text-text">45-minute coaching session</p>
            <p className="mb-4 text-sm text-text-muted">with Priya · Google Meet</p>
            <p className="mb-4 flex w-max items-center gap-2 rounded-pill bg-success-bg px-3 py-1 text-xs text-success">
              <span className="size-2 rounded-pill bg-success" />
              Google Calendar · in sync
            </p>
            <div className="grid grid-cols-3 gap-2">
              {["9:00 am", "10:30 am", "12:00 pm", "2:00 pm", "3:30 pm", "5:00 pm"].map((t) => (
                <span
                  key={t}
                  className={`rounded-sm border py-2 text-center text-sm ${t === "10:30 am" ? "border-accent bg-accent text-on-accent" : "border-border-input bg-card text-text"}`}
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs font-normal text-text-muted">Times in India Standard Time (your time) · 12h / 24h</p>
          </Card>
        </section>

        <section className={sectionClass} aria-labelledby="problem">
          <h2 id="problem" className={sectionTitle}>
            Two things a booking tool should never do
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg bg-surface p-5">
              <h3 className="text-lg text-text">Say you&apos;re free when you&apos;re not</h3>
              <p className="mt-2 text-text-muted">A calendar quietly stops syncing, a client books over another session, and you only find out when two people turn up.</p>
            </div>
            <div className="rounded-lg bg-surface p-5">
              <h3 className="text-lg text-text">Go quiet when it breaks</h3>
              <p className="mt-2 text-text-muted">You get a bot or a help article instead of an answer. And leaving turns out to be harder than joining was.</p>
            </div>
          </div>
        </section>

        <section className={sectionClass} aria-labelledby="how">
          <h2 id="how" className={sectionTitle}>
            How it works
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4 rounded-lg bg-surface p-5">
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-highlight font-semibold text-on-highlight">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg text-text">{s.title}</h3>
                  <p className="mt-1 text-text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={sectionClass} aria-labelledby="features">
          <h2 id="features" className={sectionTitle}>
            Built around what goes wrong
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-lg bg-surface p-5">
                <h3 className="text-lg text-text">{f.title}</h3>
                <p className="mt-2 text-text-muted">{f.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-text-muted">
            Also included: Google Meet and Teams links created for you; weekly repeat bookings, session packages and refundable no-show deposits; GST invoices to guests; a waitlist for full days; private client notes; a monthly earnings report; booking pages in Hindi, Tamil, Telugu and Kannada; and from your dashboard you can cancel a booking, move it to another free time, or mark a no-show.
          </p>
          <div className="mt-6 rounded-lg border border-border p-5">
            <h3 className="text-lg text-text">
              On the way {comingSoon}
            </h3>
            <ul className="mt-2 list-disc pl-5 text-text-muted">
              <li>WhatsApp reminders sent automatically, and WhatsApp sync alerts</li>
              <li>A mobile app</li>
              <li>An importer for links you already have</li>
            </ul>
          </div>
        </section>

        <section id="pricing" className={sectionClass} aria-labelledby="pricing-title">
          <h2 id="pricing-title" className={sectionTitle}>
            Simple pricing
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <Card key={p.name} className={`flex flex-col ${p.recommended ? "border-2 border-accent" : ""}`}>
                {p.recommended && <p className="mb-3 w-max rounded-pill bg-accent px-3 py-1 text-xs text-on-accent">Most people pick this</p>}
                <h3 className="text-lg text-text">{p.name}</h3>
                <p className="mb-4 text-sm text-text-muted">{p.for}</p>
                <p className="font-display text-xl text-text">
                  {p.price}
                  <span className="font-sans text-sm text-text-muted"> a month</span>
                </p>
                <p className="mb-4 mt-1 text-sm text-text-muted">{p.note ?? "Free for good"}</p>
                <ul className="mb-6 flex-1 list-disc space-y-1 pl-5 text-text">
                  {p.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <Link href="/sign-in" className={buttonClasses({ variant: p.recommended ? "primary" : "secondary" })}>
                  Start free
                </Link>
              </Card>
            ))}
          </div>
          <p className="mt-6 text-center text-text-muted">Cancel in one tap. We&apos;ll email you 7 days before every renewal.</p>
        </section>

        <section className={sectionClass} aria-labelledby="faq">
          <h2 id="faq" className={sectionTitle}>
            Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="rounded-md bg-surface px-5 py-4">
                <summary className="cursor-pointer rounded-sm font-semibold text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  {f.q}
                </summary>
                <p className="mt-2 text-text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`${sectionClass} text-center`} aria-labelledby="final">
          <h2 id="final" className={sectionTitle}>
            Book clients without double-checking your calendar.
          </h2>
          <Link href="/sign-in" className={buttonClasses({ size: "lg" })}>
            Start free
          </Link>
          <p className="mt-3 text-sm text-text-muted">No card needed.</p>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border py-8 text-sm text-text-muted">
        <p>© 2026 Marvice Media Private Limited</p>
        <LegalLinks />
      </footer>
    </div>
  );
}
