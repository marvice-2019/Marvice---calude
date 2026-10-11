import Link from "next/link";
import { ProfileForm, ProfilePhotoForm } from "@/components/ProfileForm";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const user = await requireUser();
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
    </div>
  );
}
