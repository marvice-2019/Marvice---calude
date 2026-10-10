import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { store } from "@/lib/data";

export default async function PublicEventPage({ params }: { params: Promise<{ slug: string; event: string }> }) {
  const { slug, event } = await params;
  const found = await store.getPublicEventType(slug, event);
  if (!found) notFound();
  const { host, eventType } = found;
  const questions = (await store.listCustomQuestions(eventType.id))
    .sort((a, b) => a.position - b.position)
    .map(({ id, label, kind, required }) => ({ id, label, kind, required }));
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <Link href={`/${host.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">{host.name}</Link>
      <h1 className="font-display text-xl text-text">{eventType.name}</h1>
      <p className="mt-2 text-text-muted">{eventType.durationMinutes} min</p>
      {eventType.description && <p className="mt-2 text-text">{eventType.description}</p>}
      <BookingFlow slug={host.slug} event={eventType.slug} bookingWindowDays={eventType.bookingWindowDays} questions={questions} />
    </main>
  );
}
