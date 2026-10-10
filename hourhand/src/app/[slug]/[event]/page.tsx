import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";

export default async function PublicEventPage({ params }: { params: Promise<{ slug: string; event: string }> }) {
  const { slug, event } = await params;
  const found = await store.getPublicEventType(slug, event);
  if (!found) notFound();
  const { host, eventType } = found;
  const zone = host.timezone === "Asia/Kolkata" ? "IST" : host.timezone;
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <Link href={`/${host.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">{host.name}</Link>
      <h1 className="font-display text-xl text-text">{eventType.name}</h1>
      <p className="mt-2 text-text-muted">{eventType.durationMinutes} min</p>
      <p className="mt-4 text-sm text-text-muted">Times shown in {zone}</p>
    </main>
  );
}
