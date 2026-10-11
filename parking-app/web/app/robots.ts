import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.SITE_URL ?? "http://localhost:3001";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/passes", "/account"] }], sitemap: `${base}/sitemap.xml` };
}
