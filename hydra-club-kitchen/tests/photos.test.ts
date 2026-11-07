import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPhotos, parsePhotoName } from "../scripts/import-photos";
import { photos } from "../src/db/schema";
import { addPhoto, keyFromUrl, processImage, resolveMediaPath, uploadDir } from "../src/media/photos";
import { freshDb } from "./db-helpers";

let conn: Awaited<ReturnType<typeof freshDb>>;
let workDir: string;

/** A 3000x2000 JPEG carrying EXIF (incl. a GPS-like comment) and orientation 6. */
async function photoWithExif() {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 20, g: 120, b: 160 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam", ImageDescription: "GPS 12.93N 77.62E" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

beforeAll(async () => {
  conn = await freshDb();
  workDir = await mkdtemp(path.join(tmpdir(), "hydra-photos-"));
  process.env.UPLOAD_DIR = path.join(workDir, "uploads");
});
afterAll(async () => {
  await conn?.sql.end();
  await rm(workDir, { recursive: true, force: true });
});

describe("photo pipeline", () => {
  it("resizes to 2000 px, applies the rotation, writes AVIF + WebP and strips EXIF", async () => {
    const out = await processImage(await photoWithExif());
    // Orientation 6 = rotated 90°: the 3000x2000 landscape becomes portrait, longest edge 2000.
    expect({ w: out.width, h: out.height }).toEqual({ w: 1333, h: 2000 });
    expect(out.blurhash.length).toBeGreaterThan(10);
    const files = await readdir(path.join(uploadDir(), "photos"));
    expect(files.sort()).toEqual([`${out.key}.avif`, `${out.key}.webp`]);
    for (const ext of ["webp", "avif"]) {
      const meta = await sharp(path.join(uploadDir(), "photos", `${out.key}.${ext}`)).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation ?? 1).toBe(1);
    }
    expect(meta(await sharp(path.join(uploadDir(), "photos", `${out.key}.webp`)).metadata())).toBe("webp");
  });

  it("refuses non-images and oversized files with plain messages", async () => {
    await expect(processImage(Buffer.from("not an image"))).rejects.toThrow("That isn't an image we can read");
    await expect(processImage(Buffer.alloc(16 * 1024 * 1024))).rejects.toThrow("over 15 MB");
  });

  it("keeps one hero per scene", async () => {
    const img = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#222" } }).jpeg().toBuffer();
    const a = await addPhoto(conn.db, null, img, { tag: "club", alt: "Dance floor at night", heroScene: "club" });
    const b = await addPhoto(conn.db, null, img, { tag: "club", alt: "DJ booth lit up", heroScene: "club" });
    const rows = await conn.db.select().from(photos);
    expect(rows.find((r) => r.id === a.id)!.heroScene).toBeNull();
    expect(rows.find((r) => r.id === b.id)!.heroScene).toBe("club");
  });
});

describe("media paths", () => {
  it("serves only our photo files inside UPLOAD_DIR", () => {
    expect(resolveMediaPath(["photos", "0b6c1e3a-1111-4222-8333-444455556666.webp"])).toBe(
      path.join(uploadDir(), "photos", "0b6c1e3a-1111-4222-8333-444455556666.webp"),
    );
    for (const bad of [["..", "etc", "passwd.webp"], ["photos", "..", "..", "x.webp"], ["photos", "x.svg"], ["photos", "a\\b.webp"], []]) {
      expect(resolveMediaPath(bad)).toBeNull();
    }
    expect(keyFromUrl("/media/photos/0b6c1e3a-1111-4222-8333-444455556666.avif")).toBe("0b6c1e3a-1111-4222-8333-444455556666");
    expect(keyFromUrl("https://evil.example/x.webp")).toBeNull();
  });
});

describe("import script", () => {
  it("reads tags and hero from file names, alt from .txt, and skips files already imported", async () => {
    expect(parsePhotoName("club-1-hero.jpg")).toEqual({ tag: "club", hero: true });
    expect(parsePhotoName("Bar-12.PNG")).toEqual({ tag: "bar", hero: false });
    expect(parsePhotoName("random.jpg")).toBeNull();
    const dir = path.join(workDir, "reference");
    await rm(dir, { recursive: true, force: true });
    await (await import("node:fs/promises")).mkdir(dir, { recursive: true });
    const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#123" } }).jpeg().toBuffer();
    await writeFile(path.join(dir, "kitchen-1-hero.jpg"), img);
    await writeFile(path.join(dir, "kitchen-1-hero.txt"), "Chef plating sushi at the pass\n");
    await writeFile(path.join(dir, "floor-2.jpg"), img);
    await writeFile(path.join(dir, "menu-scan.jpg"), img);
    expect(await importPhotos(conn.db, dir)).toEqual({ imported: ["floor-2.jpg", "kitchen-1-hero.jpg"], skipped: [], unrecognised: ["menu-scan.jpg"] });
    const kitchen = (await conn.db.select().from(photos)).find((p) => p.originalKey === "import:kitchen-1-hero.jpg")!;
    expect(kitchen).toMatchObject({ tag: "kitchen", heroScene: "kitchen", alt: "Chef plating sushi at the pass" });
    expect((await importPhotos(conn.db, dir)).skipped).toEqual(["floor-2.jpg", "kitchen-1-hero.jpg"]);
  });
});

function meta(m: Metadata) {
  return m.format;
}
