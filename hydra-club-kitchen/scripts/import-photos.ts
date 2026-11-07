import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client";
import { photos } from "../src/db/schema";
import { addPhoto, PHOTO_TAGS } from "../src/media/photos";

/**
 * Imports the client's photos (brief §13): `pnpm photos:import [dir]` (default reference/photos).
 * File names carry the tag, and "-hero" makes it that scene's hero: club-1-hero.jpg, bar-3.jpg.
 * Alt text comes from a same-named .txt file (club-1-hero.txt), else from the tag.
 * Re-running skips files already imported.
 */
const NAME = new RegExp(`^(${PHOTO_TAGS.join("|")})-[\\w-]*?(-hero)?\\.(jpe?g|png|webp|avif|tiff?)$`, "i");

export function parsePhotoName(file: string): { tag: (typeof PHOTO_TAGS)[number]; hero: boolean } | null {
  const m = NAME.exec(file);
  return m ? { tag: m[1]!.toLowerCase() as (typeof PHOTO_TAGS)[number], hero: Boolean(m[2]) } : null;
}

export async function importPhotos(db: Db, dir: string) {
  const files = (await readdir(dir)).sort();
  const report = { imported: [] as string[], skipped: [] as string[], unrecognised: [] as string[] };
  for (const file of files) {
    if (file.endsWith(".txt")) continue;
    const parsed = parsePhotoName(file);
    if (!parsed) {
      report.unrecognised.push(file);
      continue;
    }
    const originalKey = `import:${file}`;
    const [exists] = await db.select({ id: photos.id }).from(photos).where(eq(photos.originalKey, originalKey));
    if (exists) {
      report.skipped.push(file);
      continue;
    }
    const altFile = path.join(dir, file.replace(/\.[^.]+$/, ".txt"));
    const alt = (await readFile(altFile, "utf8").catch(() => "")).trim() || `Hydra Club & Kitchen, ${parsed.tag}`;
    await addPhoto(db, null, await readFile(path.join(dir, file)), { tag: parsed.tag, alt, heroScene: parsed.hero ? parsed.tag : null }, originalKey);
    report.imported.push(file);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.resolve(process.argv[2] ?? "reference/photos");
  const { db, sql } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
  importPhotos(db, dir)
    .then((r) => {
      console.log(`imported ${r.imported.length}, skipped ${r.skipped.length} already imported`);
      if (r.unrecognised.length) console.log(`not named <club|kitchen|bar|floor>-<n>[-hero].<ext>: ${r.unrecognised.join(", ")}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
