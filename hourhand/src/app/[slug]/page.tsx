import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { focusRing } from "@/components/ui/focus";
import { store } from "@/lib/data";

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const host = await store.getUserBySlug(slug);
  if (!host) notFound();
  const eventTypes = (await store.listEventTypes(host.id))
    .filter((et) => et.active && !et.hidden)
    .sort((a, b) => a.position - b.position);
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <h1 className="font-display text-display text-text">{host.name}</h1>
      <p className="mt-2 text-text-muted">Pick a meeting type to see open times.</p>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {eventTypes.map((et) => (
          <li key={et.id}>
            <Link href={`/${host.slug}/${et.slug}`} className={`block rounded-lg ${focusRing}`}>
              <Card className="h-full hover:border-border-input">
                <h2 className="font-display text-lg text-text">{et.name}</h2>
                <p className="mt-1 text-sm text-text-muted">{et.durationMinutes} min</p>
                {et.description && <p className="mt-2 text-sm text-text">{et.description}</p>}
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
