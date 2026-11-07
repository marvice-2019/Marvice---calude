import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser } from "@/auth/guard";
import { PhotoCard, PhotoUploader } from "@/components/admin/content-forms";
import { getDb } from "@/db";
import { photos } from "@/db/schema";

export const metadata: Metadata = { title: "Photos" };
export const dynamic = "force-dynamic";

/** §8 Photos: upload (auto-processed to AVIF + WebP + blurhash), tag, hero scene, order, delete. */
export default async function PhotosPage() {
  await requireUser("content:write");
  const rows = await getDb().select().from(photos).orderBy(asc(photos.tag), asc(photos.sort), asc(photos.id));
  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Photos</h1>
      <p className="text-muted">Dark, high-contrast shots look best under the light show. One hero per scene: Club, Kitchen, Bar, Floor.</p>
      <div className="mt-5">
        <PhotoUploader />
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">No photos yet. The site shows branded artwork until you add some.</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <PhotoCard key={p.id} p={p} />
          ))}
        </ul>
      )}
    </>
  );
}
