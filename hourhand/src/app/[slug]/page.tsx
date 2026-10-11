import { BookingFooter } from "@/components/BookingFooter";
import type { Metadata } from "next";
import Link from "next/link";
import { EmbedResize } from "@/components/EmbedResize";
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
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { resolveLocale, t } from "@/lib/i18n/guest";

/** Read once per request; the metadata and the page both need it. */
const load = cache(async (slug: string) => {
  const host = await store.getUserBySlug(slug);
  if (!host) return null;
  const profile: Profile | null = authEnabled() ? await getProfile(getPool(process.env.DATABASE_URL as string), host.id) : null;
  return { host, profile };
});

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const found = await load((await params).slug);
  if (!found) return {};
  const { host, profile } = found;
  const locale = resolveLocale((await searchParams).lang, host.locale);
  const description = profile?.headline ?? profile?.bio?.slice(0, 160) ?? t(locale, "metaDescription", { name: host.name });
  return { title: `${host.name}${profile?.headline ? ` · ${profile.headline}` : ""}`, description, openGraph: { title: host.name, description } };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { lang } = await searchParams;
  const found = await load(slug);
  if (!found) notFound();
  const { host, profile } = found;
  const locale = resolveLocale(lang, host.locale);
  // Keep an explicit choice as guests click through; otherwise the host's default applies on the next page too.
  const q = typeof lang === "string" && lang === locale ? `?lang=${locale}` : "";
  const eventTypes = (await store.listEventTypes(host.id))
    .filter((et) => et.active && !et.hidden)
    .sort((a, b) => a.position - b.position);
  const p = profile;
  const button = `inline-flex min-h-11 items-center rounded-md border border-border-input bg-card px-4 font-semibold text-text hover:bg-surface ${focusRing}`;
  const jsonLd = p && profileJsonLd({ baseUrl: (resolveBaseUrl() ?? "").replace(/\/+$/, ""), slug: host.slug, name: host.name, profile: p, services: eventTypes });
  return (
    <main lang={locale} className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <EmbedResize />
      <LanguageSwitcher locale={locale} path={`/${host.slug}`} />
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
          {p.whatsapp && <li><a className={button} href={waLink(p.whatsapp.slice(1), t(locale, "waGreeting", { name: host.name }))} rel="noopener noreferrer" target="_blank">{t(locale, "chatWhatsApp")}</a></li>}
          {p.reviewsUrl && <li><a className={button} href={p.reviewsUrl} rel="noopener noreferrer" target="_blank">{t(locale, "readReviews")}</a></li>}
          {p.instagram && <li><a className={button} href={`https://www.instagram.com/${p.instagram}/`} rel="noopener noreferrer" target="_blank">Instagram</a></li>}
        </ul>
      )}
      {p?.bio && (
        <section aria-labelledby="about" className="mt-8 max-w-2xl">
          <h2 id="about" className="font-display text-lg text-text">{t(locale, "about")}</h2>
          <p className="mt-2 whitespace-pre-line text-text">{p.bio}</p>
        </section>
      )}
      <section aria-labelledby="services" className="mt-8">
        <h2 id="services" className="font-display text-lg text-text">{t(locale, p?.bio || p?.headline ? "services" : "bookATime")}</h2>
        <p className="mt-1 text-text-muted">{t(locale, "pickService")}</p>
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {eventTypes.map((et) => (
            <li key={et.id}>
              <Link href={`/${host.slug}/${et.slug}${q}`} className={`block rounded-lg ${focusRing}`}>
                <Card className="h-full hover:border-border-input">
                  <h3 className="font-display text-lg text-text">{et.name}</h3>
                  <p className="mt-1 text-sm text-text-muted">{t(locale, "minutes", { n: et.durationMinutes })} · {et.priceMinor !== null ? formatMoney(et.priceMinor, "INR") : t(locale, "free")}</p>
                  {et.description && <p className="mt-2 text-sm text-text">{et.description}</p>}
                  <span className="mt-3 inline-block font-semibold text-accent">{t(locale, "seeTimes")}</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <BookingFooter hostId={host.id} locale={locale} />
    </main>
  );
}
