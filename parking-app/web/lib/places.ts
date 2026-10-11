import { serverGet } from "./api";
import { slugify } from "./format";
import type { Destination } from "./types";

const KINDS = ["area", "mall", "stadium", "hospital", "office", "airport", "metro"];

/** Every destination the API knows (it returns up to 8 per kind query), for SEO pages and the sitemap. */
export async function allPlaces(): Promise<(Destination & { slug: string })[]> {
  const lists = await Promise.all(KINDS.map(k => serverGet<Destination[]>(`/v1/destinations?q=${k}`, 3600).catch(() => [] as Destination[])));
  const seen = new Map<string, Destination & { slug: string }>();
  for (const d of lists.flat()) seen.set(slugify(d.name), { ...d, slug: slugify(d.name) });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
