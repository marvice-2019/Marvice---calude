# Hourhand — hourhand.cloud

A static landing page for Hourhand, a time-tracking and billable-hours product for agencies, now in early access. It runs on the Coolify server (`srv1373084`, 91.108.110.216) and is served by nginx.

Every lead goes to WhatsApp (+91 78456 67204) or email (Yuvarajgs@marvice.in). The page has no form and no backend.

## Files

| File | Purpose |
| --- | --- |
| `site/index.html` | The page itself, with all CSS inline. Includes JSON-LD for Organization, SoftwareApplication and FAQPage |
| `site/favicon.svg`, `site/og.png` (`og.svg` source) | Favicon and the 1200×630 social share image |
| `site/robots.txt`, `site/sitemap.xml` | For Search Console. The domain property is already verified |
| `nginx.conf` | Gzip, security headers, 7-day caching for static assets |
| `Dockerfile` | `nginx:1.27-alpine` serving `site/` on port 80 |

## 1. DNS (Hostinger) — already done

`hourhand.cloud` → A → `91.108.110.216`, and `www` is a CNAME to `hourhand.cloud`. Both were confirmed on 2026-10-13.

## 2. Coolify

1. Go to **Projects → + New → Resource → Public/Private Repository** and pick the repo `marvice-2019/Marvice---calude`, branch `main`.
2. Build pack: **Dockerfile**. Base directory: `/hourhand.cloud`. Dockerfile location: `/Dockerfile`.
3. Set **Ports Exposes** to `80`.
4. Set **Domains** to `https://hourhand.cloud,https://www.hourhand.cloud`.
5. Under **Advanced**, set **Redirect** to *Redirect to non-www*.
6. Click **Deploy**. The build takes about 30 seconds. Traefik then requests the Let's Encrypt certificate.

## 3. Check it's live

```bash
curl -sI https://hourhand.cloud/ | head -3          # HTTP/2 200, valid cert
curl -sI https://www.hourhand.cloud/ | grep -i location   # redirects to https://hourhand.cloud/
curl -s https://hourhand.cloud/sitemap.xml | head -3
```

Then go to Search Console → hourhand.cloud → Sitemaps and submit `https://hourhand.cloud/sitemap.xml`.

## Editing

Edit `site/index.html`, then commit and push to `main`. Redeploy in Coolify, or turn on **Automatic deploy** under the resource's **Webhooks** tab so every push deploys by itself.
