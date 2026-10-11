/** Booking-link slugs must match users.slug's check: 3–40 chars of a-z, 0-9 and hyphens, starting with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** A slug from a name, or the email's local part when there is no name. Always valid, at most 33 chars to leave room for a suffix. */
export function baseSlug(email: string, name?: string | null): string {
  const source = name?.trim() || email.split("@")[0] || "";
  const cleaned = source
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 33)
    .replace(/-+$/g, "");
  return cleaned.length >= 3 ? cleaned : `host-${cleaned || "new"}`.replace(/-+$/g, "");
}

/** Top-level paths the app owns. A host with one of these slugs would have a booking page nobody can reach. */
export const RESERVED_SLUGS = new Set([
  "about", "admin", "api", "app", "auth", "b", "billing", "blog", "dashboard", "help", "login", "logout",
  "onboarding", "pricing", "privacy", "settings", "sign-in", "sign-out", "sign-up", "signin", "signup",
  "static", "support", "terms", "www",
]);

/** The first free slug: the base, then base-2, base-3 … and finally a random suffix. Reserved words count as taken. */
export async function uniqueSlug(email: string, name: string | null | undefined, isTakenInDb: (slug: string) => Promise<boolean>): Promise<string> {
  const isTaken = async (slug: string) => RESERVED_SLUGS.has(slug) || isTakenInDb(slug);
  const base = baseSlug(email, name);
  if (!(await isTaken(base))) return base;
  for (let n = 2; n <= 20; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
