import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { encode } from "blurhash";
import { eq } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import type { Db } from "@/db/client";
import { auditLog, photos } from "@/db/schema";

/**
 * Photo pipeline (brief §13): any common image in, a 2000 px AVIF + WebP pair
 * and a blurhash out. EXIF (incl. GPS) is dropped: sharp writes no metadata
 * unless asked, and rotate() bakes the orientation in first.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_EDGE = 2000;
const ACCEPTED = new Set(["jpeg", "png", "webp", "avif", "tiff", "heif"]);
export const PHOTO_TAGS = ["club", "kitchen", "bar", "floor"] as const;

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));
}

export const photoMetaSchema = z.object({
  tag: z.enum(PHOTO_TAGS),
  alt: z.string().trim().min(3, "Describe the photo for people who can't see it.").max(200),
  heroScene: z.enum(PHOTO_TAGS).nullable().optional(),
});

export type ProcessedPhoto = { key: string; avifUrl: string; webpUrl: string; blurhash: string; width: number; height: number };

/** Validates and converts one image; writes files under UPLOAD_DIR/photos. Throws a user-facing Error on bad input. */
export async function processImage(input: Buffer): Promise<ProcessedPhoto> {
  if (input.length > MAX_UPLOAD_BYTES) throw new Error("That file is over 15 MB.");
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error("That isn't an image we can read. Use JPG, PNG, WebP or AVIF.");
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) throw new Error("Use JPG, PNG, WebP or AVIF.");

  const base = sharp(input, { failOn: "error" }).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
  const { data: webp, info } = await base.clone().webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
  const avif = await base.clone().avif({ quality: 50, effort: 4 }).toBuffer();
  const { data: raw, info: small } = await base.clone().resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blurhash = encode(new Uint8ClampedArray(raw), small.width, small.height, 4, 3);

  const key = randomUUID();
  const dir = path.join(uploadDir(), "photos");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${key}.webp`), webp);
  await writeFile(path.join(dir, `${key}.avif`), avif);
  return { key, avifUrl: `/media/photos/${key}.avif`, webpUrl: `/media/photos/${key}.webp`, blurhash, width: info.width, height: info.height };
}

/** Process + store one photo row. Setting a hero scene takes it from any other photo first (one per scene). */
export async function addPhoto(db: Db, userId: string | null, input: Buffer, rawMeta: unknown, originalKey?: string) {
  const meta = photoMetaSchema.parse(rawMeta);
  const p = await processImage(input);
  try {
    return await db.transaction(async (tx) => {
      if (meta.heroScene) await tx.update(photos).set({ heroScene: null }).where(eq(photos.heroScene, meta.heroScene));
      const [row] = await tx
        .insert(photos)
        .values({
          tag: meta.tag,
          alt: meta.alt,
          hero: Boolean(meta.heroScene),
          heroScene: meta.heroScene ?? null,
          originalKey: originalKey ?? `upload:${p.key}`,
          avifUrl: p.avifUrl,
          webpUrl: p.webpUrl,
          blurhash: p.blurhash,
          width: p.width,
          height: p.height,
          sort: Date.now() % 2_000_000_000,
        })
        .returning();
      await tx.insert(auditLog).values({ userId, action: "photo.create", entity: "photo", entityId: String(row!.id), diff: { tag: meta.tag, heroScene: meta.heroScene ?? null } });
      return row!;
    });
  } catch (err) {
    await removeFiles(p.key);
    throw err;
  }
}

export async function removeFiles(key: string) {
  const dir = path.join(uploadDir(), "photos");
  await Promise.all([rm(path.join(dir, `${key}.webp`), { force: true }), rm(path.join(dir, `${key}.avif`), { force: true })]);
}

/** File key from a stored URL ("/media/photos/<uuid>.webp" → "<uuid>"), or null if it isn't one of ours. */
export function keyFromUrl(url: string): string | null {
  return /^\/media\/photos\/([0-9a-f-]{36})\.(?:webp|avif)$/.exec(url)?.[1] ?? null;
}

/** Resolves a /media/* request path to a file inside UPLOAD_DIR, refusing anything that escapes it. */
export function resolveMediaPath(parts: string[]): string | null {
  if (parts.length === 0 || parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return null;
  if (!/^[\w-]+\.(webp|avif)$/.test(parts.at(-1)!)) return null;
  const root = uploadDir();
  const full = path.resolve(root, ...parts);
  return full.startsWith(root + path.sep) ? full : null;
}
