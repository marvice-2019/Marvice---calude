import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * Builds the site's brand files from the client's logo (reference/Hydra_logo.png):
 *   public/brand/hydra-emblem.png   dragon emblem only, transparent (header, hero, footer, admin)
 *   public/brand/hydra-logo.png     full lockup, transparent
 *   src/app/icon.png, apple-icon.png  emblem on the brand's dark background (favicon, home screen)
 * Run: pnpm brand:assets. Re-run when Hydra sends the SVG (see README).
 */
const SRC = "reference/Hydra_logo.png";
const BG = { r: 3, g: 7, b: 13, alpha: 1 }; // --bg #03070D

async function bounds(rowStart: number, rowEnd: number) {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
  for (let y = rowStart; y < Math.min(rowEnd, info.height); y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (a > 20 && !(r > 235 && g > 235 && b > 235)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The emblem is everything above the first fully empty band of rows under it. */
async function emblemRows() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const filled = (y: number) => {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3]! > 20 && !(data[i]! > 235 && data[i + 1]! > 235 && data[i + 2]! > 235)) return true;
    }
    return false;
  };
  let y = 0;
  while (y < info.height && !filled(y)) y++;
  while (y < info.height && filled(y)) y++;
  return y; // first empty row after the emblem
}

async function main() {
  await mkdir("public/brand", { recursive: true });
  const emblemBox = await bounds(0, await emblemRows());
  const pad = 6;
  const emblem = sharp(SRC).extract({
    left: Math.max(0, emblemBox.left - pad),
    top: Math.max(0, emblemBox.top - pad),
    width: emblemBox.width + pad * 2,
    height: emblemBox.height + pad * 2,
  });
  const emblemPng = await emblem.png({ compressionLevel: 9, palette: true, quality: 92 }).toBuffer();
  await sharp(emblemPng).toFile("public/brand/hydra-emblem.png");

  const full = await bounds(0, 10_000);
  await sharp(SRC).extract(full).png({ compressionLevel: 9, palette: true, quality: 92 }).toFile("public/brand/hydra-logo.png");

  const tile = async (size: number, out: string) => {
    const inner = Math.round(size * 0.78);
    const mark = await sharp(emblemPng).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
      .composite([{ input: mark, gravity: "center" }])
      .png({ compressionLevel: 9, palette: true, quality: 92 })
      .toFile(out);
  };
  await tile(512, "src/app/icon.png");
  await tile(180, "src/app/apple-icon.png");

  const meta = await sharp("public/brand/hydra-emblem.png").metadata();
  console.log(`emblem ${meta.width}x${meta.height}, logo ${full.width}x${full.height}, icons 512 + 180`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
