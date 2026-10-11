import { BookingFooter } from "@/components/BookingFooter";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { formatMoney } from "@/lib/billing/plans";
import { store } from "@/lib/data";

export default async function PublicEventPage({ params, searchParams }: { params: Promise<{ slug: string; event: string }>; searchParams: Promise<{ at?: string }> }) {
  const { slug, event } = await params;
  const { at } = await searchParams;
  const found = await store.getPublicEventType(slug, event);
  if (!found) notFound();
  const { host, eventType } = found;
  const questions = (await store.listCustomQuestions(host.id, eventType.id))
    .sort((a, b) => a.position - b.position)
    .map(({ id, label, kind, required }) => ({ id, label, kind, required }));
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <Link href={`/${host.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">{host.name}</Link>
      <h1 className="font-display text-xl text-text">{eventType.name}</h1>
      <p className="mt-2 text-text-muted">{eventType.durationMinutes} min{eventType.priceMinor !== null && ` · ${formatMoney(eventType.priceMinor, "INR")}`}</p>
      {eventType.description && <p className="mt-2 text-text">{eventType.description}</p>}
      <BookingFlow
        slug={host.slug} event={eventType.slug} initialAt={typeof at === "string" ? at : undefined} bookingWindowDays={eventType.bookingWindowDays} questions={questions}
        paid={eventType.priceMinor !== null ? { price: formatMoney(eventType.priceMinor, "INR"), hostName: host.name, eventName: eventType.name } : null}
      />
      <BookingFooter hostId={host.id} />
    </main>
  );
}
