import type pg from "pg";

// The host's page as a small website: a photo, a few lines about them, how to reach them and where their reviews are.
// All of it is public on /{slug}.

type Db = Pick<pg.Pool, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export interface Profile { headline: string | null; bio: string | null; area: string | null; whatsapp: string | null; instagram: string | null; reviewsUrl: string | null; hasPhoto: boolean; photoVersion: number }

const EMPTY: Profile = { headline: null, bio: null, area: null, whatsapp: null, instagram: null, reviewsUrl: null, hasPhoto: false, photoVersion: 0 };

/** Review pages the button may point at: Google's own hosts only, so the page can't send guests anywhere else under that label. */
const REVIEW_HOSTS = /^(g\.page|maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6}|search\.google\.com)$/;

export type ProfileInput = Omit<Profile, "hasPhoto" | "photoVersion">;

/** Checks the settings form. Empty fields clear; an Indian 10-digit mobile gets +91. */
export function validateProfile(input: Record<string, string>): { ok: true; value: ProfileInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const v = (k: string) => (input[k] ?? "").trim();
  const opt = (s: string) => (s === "" ? null : s);
  const headline = v("headline"), bio = v("bio").replace(/\r\n/g, "\n"), area = v("area");
  if (headline.length > 120) errors.headline = "Keep the headline to 120 characters.";
  if (bio.length > 2000) errors.bio = "Keep the about text to 2,000 characters.";
  if (area.length > 120) errors.area = "Keep the area to 120 characters.";

  let whatsapp: string | null = v("whatsapp").replace(/[\s()-]/g, "");
  if (whatsapp === "") whatsapp = null;
  else if (/^[6-9]\d{9}$/.test(whatsapp)) whatsapp = `+91${whatsapp}`;
  if (whatsapp !== null && !/^\+[1-9]\d{7,14}$/.test(whatsapp)) errors.whatsapp = "Enter the number with its country code, like +91 98765 43210.";

  const instagram = v("instagram").replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
  if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) errors.instagram = "Enter your Instagram username, like priya.coaching.";

  const reviewsUrl = v("reviewsUrl");
  if (reviewsUrl) {
    let ok = false;
    try {
      const u = new URL(reviewsUrl);
      ok = u.protocol === "https:" && REVIEW_HOSTS.test(u.hostname) && reviewsUrl.length <= 500;
    } catch { /* not a URL */ }
    if (!ok) errors.reviewsUrl = "Paste the https link to your Google reviews (from Google Maps or your Business Profile's Share button).";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { headline: opt(headline), bio: opt(bio), area: opt(area), whatsapp, instagram: opt(instagram), reviewsUrl: opt(reviewsUrl) } };
}

export async function getProfile(db: Db, userId: string): Promise<Profile> {
  if (!UUID.test(userId)) return EMPTY;
  const { rows: [r] } = await db.query(
    `select p.headline, p.bio, p.area, p.whatsapp, p.instagram, p.reviews_url, ph.updated_at as photo_at
     from users u left join profiles p on p.user_id = u.id left join profile_photos ph on ph.user_id = u.id where u.id = $1`, [userId]);
  if (!r) return EMPTY;
  return { headline: r.headline, bio: r.bio, area: r.area, whatsapp: r.whatsapp, instagram: r.instagram, reviewsUrl: r.reviews_url,
    hasPhoto: r.photo_at !== null, photoVersion: r.photo_at ? new Date(r.photo_at).getTime() : 0 };
}

export async function saveProfile(db: Db, userId: string, p: ProfileInput): Promise<void> {
  await db.query(
    `insert into profiles (user_id, headline, bio, area, whatsapp, instagram, reviews_url) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update set headline = $2, bio = $3, area = $4, whatsapp = $5, instagram = $6, reviews_url = $7, updated_at = now()`,
    [userId, p.headline, p.bio, p.area, p.whatsapp, p.instagram, p.reviewsUrl]);
}

/** The file's own first bytes decide its type; the name and the browser's claim are ignored. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => bytes[i + k] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export class PhotoRejectedError extends Error {
  constructor(readonly reason: "too_big" | "not_an_image") { super(`photo rejected: ${reason}`); this.name = "PhotoRejectedError"; }
}

export async function savePhoto(db: Db, userId: string, bytes: Uint8Array): Promise<void> {
  if (bytes.length > PHOTO_MAX_BYTES) throw new PhotoRejectedError("too_big");
  const mime = sniffImage(bytes);
  if (!mime) throw new PhotoRejectedError("not_an_image");
  await db.query(
    `insert into profile_photos (user_id, mime, data) values ($1, $2, $3)
     on conflict (user_id) do update set mime = $2, data = $3, updated_at = now()`, [userId, mime, Buffer.from(bytes)]);
}

export async function removePhoto(db: Db, userId: string): Promise<void> {
  await db.query("delete from profile_photos where user_id = $1", [userId]);
}

/** A live host's photo, by their page's slug. Closed accounts have none. */
export async function photoBySlug(db: Db, slug: string): Promise<{ mime: string; data: Buffer; updatedAt: Date } | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/i.test(slug)) return null;
  const { rows: [r] } = await db.query(
    "select ph.mime, ph.data, ph.updated_at from profile_photos ph join users u on u.id = ph.user_id where u.slug = $1 and u.deleted_at is null", [slug]);
  return r ? { mime: r.mime, data: r.data, updatedAt: r.updated_at } : null;
}

/** schema.org markup for the page, so search engines and AI answers can read who this is, what they offer and at what price. */
export function profileJsonLd(o: { baseUrl: string; slug: string; name: string; profile: Profile; services: { name: string; slug: string; description: string | null; priceMinor: number | null }[] }): string {
  const url = `${o.baseUrl}/${o.slug}`;
  const p = o.profile;
  const data = {
    "@context": "https://schema.org", "@type": "ProfessionalService", name: o.name, url,
    ...(p.headline || p.bio ? { description: p.headline ?? p.bio } : {}),
    ...(p.hasPhoto ? { image: `${o.baseUrl}/api/photo/${o.slug}` } : {}),
    ...(p.area ? { areaServed: p.area } : {}),
    ...(p.whatsapp ? { telephone: p.whatsapp } : {}),
    ...(p.instagram || p.reviewsUrl ? { sameAs: [p.instagram && `https://www.instagram.com/${p.instagram}/`, p.reviewsUrl].filter(Boolean) } : {}),
    makesOffer: o.services.map((s) => ({
      "@type": "Offer", url: `${url}/${s.slug}`,
      itemOffered: { "@type": "Service", name: s.name, ...(s.description ? { description: s.description } : {}) },
      ...(s.priceMinor !== null ? { price: (s.priceMinor / 100).toFixed(2), priceCurrency: "INR" } : {}),
    })),
  };
  // Safe inside <script>: no "</script>" or "<!--" can come through.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
