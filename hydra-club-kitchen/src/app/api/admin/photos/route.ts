import { asc } from "drizzle-orm";
import { deletePhoto, updatePhoto } from "@/admin/content";
import { requireApiUser } from "@/auth/guard";
import { getDb } from "@/db";
import { photos } from "@/db/schema";
import { BadBody, badBody, json, readJson } from "@/lib/http";
import { addPhoto, MAX_UPLOAD_BYTES } from "@/media/photos";

type R = { ok: true } | { ok: false; status: number; message: string };
const respond = (r: R) => (r.ok ? json(r) : json({ ok: false, message: r.message }, r.status));

export async function GET(req: Request) {
  const user = await requireApiUser(req, "content:write");
  if (user instanceof Response) return user;
  return json({ ok: true, photos: await getDb().select().from(photos).orderBy(asc(photos.tag), asc(photos.sort)) });
}

/** POST multipart: file, tag, alt, heroScene? → processed AVIF + WebP + blurhash. */
export async function POST(req: Request) {
  const user = await requireApiUser(req, "content:write");
  if (user instanceof Response) return user;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64_000) return json({ ok: false, message: "That file is over 15 MB." }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, message: "Upload a photo file." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, message: "Choose a photo to upload." }, 400);
  try {
    const row = await addPhoto(getDb(), user.id, Buffer.from(await file.arrayBuffer()), {
      tag: form.get("tag"),
      alt: form.get("alt"),
      heroScene: form.get("heroScene") || null,
    });
    return json({ ok: true, photo: row }, 201);
  } catch (err) {
    const message = err instanceof Error && !("issues" in err) ? err.message : "Pick a tag and describe the photo (at least 3 characters).";
    return json({ ok: false, message }, 400);
  }
}

/** PATCH { id, tag?, alt?, heroScene?, sort? } */
export async function PATCH(req: Request) {
  const user = await requireApiUser(req, "content:write");
  if (user instanceof Response) return user;
  try {
    return respond(await updatePhoto(getDb(), user.id, await readJson(req)));
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
}

/** DELETE ?id= (also removes the files) */
export async function DELETE(req: Request) {
  const user = await requireApiUser(req, "content:write");
  if (user instanceof Response) return user;
  return respond(await deletePhoto(getDb(), user.id, new URL(req.url).searchParams.get("id")));
}
