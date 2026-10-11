import type { MetadataRoute } from "next";
import { AREAS, VENUES } from "@/lib/places";
import { lotsNear } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({ url: SITE_URL + path, lastModified: now, changeFrequency: "daily", priority });
  const lots = new Set<string>();
  for (const p of [...AREAS, ...VENUES]) (await lotsNear(p.lat, p.lng))?.forEach(r => lots.add(r.lot.code));
  return [
    page("/", 1), page("/parking/bengaluru", 0.9), page("/monthly", 0.7), page("/list-your-space", 0.6),
    ...AREAS.map(a => page(`/parking/bengaluru/${a.slug}`, 0.8)),
    ...VENUES.map(v => page(`/parking/bengaluru/venue/${v.slug}`, 0.8)),
    ...[...lots].sort().map(c => page(`/parking/bengaluru/lot/${c}`, 0.7))
  ];
}
