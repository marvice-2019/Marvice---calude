import Link from "next/link";
import { focusRing } from "@/components/ui/focus";

export const metadata = { title: "Offline · Hourhand" };

// Cached by the service worker (public/sw.js) and shown when a page can't be fetched.
export default function Offline() {
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-16">
      <h1 className="font-display text-xl text-text">You&apos;re offline</h1>
      <p className="mt-2 text-text-muted">Hourhand needs a connection to show your bookings. Check your signal and try again.</p>
      <Link href="/dashboard" className={`mt-4 inline-flex min-h-11 items-center rounded-sm font-semibold text-accent underline ${focusRing}`}>Try again</Link>
    </main>
  );
}
