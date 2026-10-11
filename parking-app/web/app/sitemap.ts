import type { MetadataRoute } from "next";
import { allPlaces } from "@/lib/places";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.SITE_URL ?? "http://localhost:3001";
  const fixed = ["", "/park-now", "/valet", "/monthly", "/list-your-space"].map(p => ({ url: base + p, changeFrequency: "weekly" as const, priority: p ? 0.6 : 1 }));
  const places = (await allPlaces()).map(p => ({ url: `${base}/parking/${p.slug}`, changeFrequency: "daily" as const, priority: 0.8 }));
  return [...fixed, ...places];
}
