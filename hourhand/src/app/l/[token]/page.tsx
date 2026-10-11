import type { Metadata } from "next";
import { BookingFlow } from "@/components/BookingFlow";
import { BookingFooter } from "@/components/BookingFooter";
import { formatMoney } from "@/lib/billing/plans";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";
// A link is for one person: keep it out of search results and away from referrer headers.
export const metadata: Metadata = { title: "Book a time · Hourhand", robots: { index: false, follow: false }, referrer: "no-referrer" };

const GONE: Record<string, { title: string; body: string }> = {
  used: { title: "This link has already been used", body: "Someone has booked with it. If that was you, your confirmation is in your email." },
  expired: { title: "This link has expired", body: "Ask the person who sent it for a new one." },
  revoked: { title: "This link no longer works", body: "Ask the person who sent it for a new one." },
  not_found: { title: "This link doesn't work", body: "Check you copied all of it, or ask the person who sent it for a new one." },
};

/** A single-use or one-off link. Anything but an open link shows only its state, never whose it was. */
export default async function LinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await store.resolveBookingLink(token, new Date());
  if (resolved.status !== "open") {
    const msg = GONE[resolved.status];
    return (
      <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
        <h1 className="font-display text-xl text-text">{msg.title}</h1>
        <p className="mt-2 text-text-muted">{msg.body}</p>
      </main>
    );
  }
  const { host, eventType } = resolved;
  const questions = (await store.listCustomQuestions(host.id, eventType.id))
    .sort((a, b) => a.position - b.position)
    .map(({ id, label, kind, required }) => ({ id, label, kind, required }));
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <p className="text-sm font-semibold text-text-muted">{host.name}</p>
      <h1 className="font-display text-xl text-text">{eventType.name}</h1>
      <p className="mt-2 text-text-muted">
        {eventType.durationMinutes} min{eventType.priceMinor !== null && ` · ${formatMoney(eventType.priceMinor, "INR")}`}
        {eventType.kind === "one_off" ? " · pick one of the times offered" : " · this link works for one booking"}
      </p>
      {eventType.description && <p className="mt-2 text-text">{eventType.description}</p>}
      <BookingFlow
        slug={host.slug} event={eventType.slug} linkToken={token} bookingWindowDays={eventType.bookingWindowDays} questions={questions}
        paid={eventType.priceMinor !== null ? { price: formatMoney(eventType.priceMinor, "INR"), hostName: host.name, eventName: eventType.name } : null}
      />
      <BookingFooter hostId={host.id} />
    </main>
  );
}
