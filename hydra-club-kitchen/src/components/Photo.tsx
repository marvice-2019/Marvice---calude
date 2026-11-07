import "server-only";
import { decode } from "blurhash";
import Image from "next/image";
import sharp from "sharp";
import type { PhotoInfo } from "@/lib/home-data";

/** Tiny blurred PNG from the stored blurhash, inlined as the placeholder (no client JS). */
async function blurDataUrl(hash: string, width: number, height: number): Promise<string | undefined> {
  try {
    const w = 32;
    const h = Math.max(1, Math.round((32 * height) / width));
    const pixels = decode(hash, w, h);
    const png = await sharp(Buffer.from(pixels), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Every venue photo goes through here. Source files are already resized and
 * EXIF-stripped by the photo pipeline; next/image serves AVIF/WebP at the right
 * width. `priority` only for the LCP image (first hero scene).
 */
export async function Photo({
  photo,
  sizes,
  priority = false,
  className,
  fill = false,
}: {
  photo: Pick<PhotoInfo, "webpUrl" | "alt" | "width" | "height" | "blurhash">;
  sizes: string;
  priority?: boolean;
  className?: string;
  fill?: boolean;
}) {
  const blur = await blurDataUrl(photo.blurhash, photo.width, photo.height);
  const common = {
    src: photo.webpUrl,
    alt: photo.alt,
    sizes,
    priority,
    className,
    placeholder: blur ? ("blur" as const) : ("empty" as const),
    blurDataURL: blur,
  };
  return fill ? <Image {...common} fill /> : <Image {...common} width={photo.width} height={photo.height} />;
}
