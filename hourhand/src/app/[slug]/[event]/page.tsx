import { BookingFooter } from "@/components/BookingFooter";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { formatMoney } from "@/lib/billing/plans";
import { authEnabled } from "@/lib/auth/auth";
import { store } from "@/lib/data";
import { getPool } from "@/lib/data/pg-store";
import { packagesForEventType } from "@/lib/packages/packages";

export default async function PublicEventPage({ params, searchParams }: { params: Promise<{ slug: string; event: string }>; searchParams: Promise<{ at?: string }> }) {
  const { slug, event } = await params;
  const { at } = await searchParams;
  const found = await store.getPublicEventType(slug, event);
  if (!found) notFound();
  const { host, eventType } = found;
  const questions = (await store.listCustomQuestions(host.id, eventType.id))
    .sort((a, b) => a.position - b.position)
    .map(({ id, label, kind, required }) => ({ id, label, kind, required }));
  // Packages need Postgres (they're paid through Razorpay); the demo data has none.
  const packages = authEnabled() ? await packagesForEventType(getPool(process.env.DATABASE_URL as string), host.id, eventType.id) : [];
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <Link href={`/${host.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">{host.name}</Link>
      <h1 className="font-display text-xl text-text">{eventType.name}</h1>
      <p className="mt-2 text-text-muted">{eventType.durationMinutes} min{eventType.priceMinor !== null && ` · ${formatMoney(eventType.priceMinor, "INR")}`}</p>
      {eventType.description && <p className="mt-2 text-text">{eventType.description}</p>}
      {packages.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-6">
          {packages.map((p) => (
            <li key={p.id}>
              <Link href={`/pkg/${p.id}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">
                Save with {p.sessions} sessions for {formatMoney(p.priceMinor, "INR")}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <BookingFlow
        slug={host.slug} event={eventType.slug} host={{ name: host.name, timezone: host.timezone }} maxWeeks={eventType.priceMinor === null ? eventType.maxRepeats : 1} initialAt={typeof at === "string" ? at : undefined} bookingWindowDays={eventType.bookingWindowDays} questions={questions}
        paid={eventType.priceMinor !== null ? { price: formatMoney(eventType.priceMinor, "INR"), hostName: host.name, eventName: eventType.name } : null}
      />
      <BookingFooter hostId={host.id} />
    </main>
  );
}
