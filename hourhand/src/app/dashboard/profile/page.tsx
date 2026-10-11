import Link from "next/link";
import { ProfileForm, ProfilePhotoForm } from "@/components/ProfileForm";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { requireHost } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { getProfile } from "@/lib/profile";
import { resolveBaseUrl } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const user = await requireHost();
  const db = authEnabled() ? getPool(process.env.DATABASE_URL as string) : null;
  const profile = db ? await getProfile(db, user.id) : null;
  return (
    <div>
      <h1 className="font-display text-xl text-text">Your page</h1>
      <p className="mt-2 max-w-xl text-text-muted">
        Your booking page doubles as a small website: your photo, a few lines about you, your services and prices, and how to reach you.
        Share <Link href={`/${user.slug}`} className="font-semibold text-accent underline">/{user.slug}</Link> as your homepage.
      </p>
      {!profile ? <p className="mt-6 text-text-muted">This demo copy has no database, so the page can&apos;t be edited here.</p> : (
        <>
          <Card className="mt-6 max-w-xl"><ProfilePhotoForm photoUrl={profile.hasPhoto ? `/api/photo/${user.slug}?v=${profile.photoVersion}` : null} /></Card>
          <Card className="mt-6 max-w-xl"><ProfileForm profile={profile} /></Card>
        </>
      )}
      <EmbedCard base={(resolveBaseUrl() ?? "").replace(/\/+$/, "")} slug={user.slug} />
    </div>
  );
}

/** Copy-and-paste code for the host's own website: the page inline, or a button that opens it. */
function EmbedCard({ base, slug }: { base: string; slug: string }) {
  const page = `${base}/${slug}`;
  const inline = `<div data-hourhand-inline="${page}"></div>\n<script src="${base}/embed.js" async></script>`;
  const popup = `<button data-hourhand-popup="${page}">Book a session</button>\n<script src="${base}/embed.js" async></script>`;
  const code = "mt-2 block overflow-x-auto whitespace-pre rounded-md bg-surface p-3 font-mono text-sm text-text";
  return (
    <Card className="mt-6 max-w-xl">
      <h2 className="font-semibold text-text">Put it on your website</h2>
      <p className="mt-1 text-text-muted">
        Paste one of these where you want it on your site. For one service only, use that event type&apos;s link instead of {page}.
        Add <code>?name=</code> and <code>?email=</code> to a link to fill those in for the guest.
      </p>
      <h3 className="mt-4 text-sm font-semibold text-text">On the page</h3>
      <code className={code}>{inline}</code>
      <h3 className="mt-4 text-sm font-semibold text-text">As a button that opens it</h3>
      <code className={code}>{popup}</code>
    </Card>
  );
}
