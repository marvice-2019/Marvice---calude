import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/auth";
import { getPool } from "@/lib/data/pg-store";
import { photoBySlug } from "@/lib/profile";

export const dynamic = "force-dynamic";

/** A host's public photo. The page links it with ?v=<version>, so a cached copy never outlives a new upload for long. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const photo = authEnabled() ? await photoBySlug(getPool(process.env.DATABASE_URL as string), slug) : null;
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      "content-type": photo.mime, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox", "last-modified": photo.updatedAt.toUTCString(),
    },
  });
}
