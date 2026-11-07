import { readFile } from "node:fs/promises";
import { resolveMediaPath } from "@/media/photos";

/**
 * Serves processed venue photos from UPLOAD_DIR (a Coolify persistent volume).
 * File names are random keys, so responses are cached for a year.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = resolveMediaPath((await params).path);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": file.endsWith(".avif") ? "image/avif" : "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
