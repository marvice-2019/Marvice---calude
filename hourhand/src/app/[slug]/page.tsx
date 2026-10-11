import { BookingFooter } from "@/components/BookingFooter";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Card } from "@/components/ui/Card";
import { focusRing } from "@/components/ui/focus";
import { authEnabled, resolveBaseUrl } from "@/lib/auth/auth";
import { formatMoney } from "@/lib/billing/plans";
import { store } from "@/lib/data";
import { getPool } from "@/lib/data/pg-store";
import { getProfile, profileJsonLd, type Profile } from "@/lib/profile";
import { waLink } from "@/lib/whatsapp";

/** Read once per request; the metadata and the page both need it. */
const load = cache(async (slug: string) => {
  const host = await store.getUserBySlug(slug);
  if (!host) return null;
  const profile: Profile | null = authEnabled() ? await getProfile(getPool(process.env.DATABASE_URL as string), host.id) : null;
  return { host, profile };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const found = await load((await params).slug);
  if (!found) return {};
  const { host, profile } = found;
  const description = profile?.headline ?? profile?.bio?.slice(0, 160) ?? `Book a time with ${host.name}.`;
  return { title: `${host.name}${profile?.headline ? ` · ${profile.headline}` : ""}`, description, openGraph: { title: host.name, description } };
}

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) notFound();
  const { host, profile } = found;
  const eventTypes = (await store.listEventTypes(host.id))
    .filter((et) => et.active && !et.hidden)
    .sort((a, b) => a.position - b.position);
  const p = profile;
  const button = `inline-flex min-h-11 items-center rounded-md border border-border-input bg-card px-4 font-semibold text-text hover:bg-surface ${focusRing}`;
  const jsonLd = p && profileJsonLd({ baseUrl: (resolveBaseUrl() ?? "").replace(/\/+$/, ""), slug: host.slug, name: host.name, profile: p, services: eventTypes });
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- the host's own upload, served by our route */}
        {p?.hasPhoto && <img src={`/api/photo/${host.slug}?v=${p.photoVersion}`} alt={host.name} width={112} height={112} className="h-28 w-28 rounded-full object-cover" />}
        <div>
          <h1 className="font-display text-display text-text">{host.name}</h1>
          {p?.headline && <p className="mt-1 text-lg text-text">{p.headline}</p>}
          {p?.area && <p className="mt-1 text-text-muted">{p.area}</p>}
        </div>
      </header>
      {p && (p.whatsapp || p.instagram || p.reviewsUrl) && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {p.whatsapp && <li><a className={button} href={waLink(p.whatsapp.slice(1), `Hi ${host.name}, I found your booking page.`)} rel="noopener noreferrer" target="_blank">Chat on WhatsApp</a></li>}
          {p.reviewsUrl && <li><a className={button} href={p.reviewsUrl} rel="noopener noreferrer" target="_blank">Read reviews on Google</a></li>}
          {p.instagram && <li><a className={button} href={`https://www.instagram.com/${p.instagram}/`} rel="noopener noreferrer" target="_blank">Instagram</a></li>}
        </ul>
      )}
      {p?.bio && (
        <section aria-labelledby="about" className="mt-8 max-w-2xl">
          <h2 id="about" className="font-display text-lg text-text">About</h2>
          <p className="mt-2 whitespace-pre-line text-text">{p.bio}</p>
        </section>
      )}
      <section aria-labelledby="services" className="mt-8">
        <h2 id="services" className="font-display text-lg text-text">{p?.bio || p?.headline ? "Services" : "Book a time"}</h2>
        <p className="mt-1 text-text-muted">Pick one to see open times.</p>
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {eventTypes.map((et) => (
            <li key={et.id}>
              <Link href={`/${host.slug}/${et.slug}`} className={`block rounded-lg ${focusRing}`}>
                <Card className="h-full hover:border-border-input">
                  <h3 className="font-display text-lg text-text">{et.name}</h3>
                  <p className="mt-1 text-sm text-text-muted">{et.durationMinutes} min · {et.priceMinor !== null ? formatMoney(et.priceMinor, "INR") : "Free"}</p>
                  {et.description && <p className="mt-2 text-sm text-text">{et.description}</p>}
                  <span className="mt-3 inline-block font-semibold text-accent">See times</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <BookingFooter hostId={host.id} />
    </main>
  );
}
