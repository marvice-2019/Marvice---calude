# Luftek Engineering — website

Static site for Luftek Engineering Private Limited (AHU / FCU manufacturer, Chennai). No build step.

- `index.html` — single page: hero, product explorer (10 lines), EN 1886 construction, certification, 37 references, company timeline and plant, contact.
- `assets/css/style.css`, `assets/js/main.js` — product and project data live in `main.js`.
- `assets/img/` — all photography is Luftek's own, taken from luftek.in (Nov 2026) and converted to WebP (2.3 MB total).

## Run locally

```bash
cd luftek-website && python3 -m http.server 8080
```

## Deploy (Coolify)

New resource → Static site → this repo, base directory `luftek-website`, no build command, publish directory `/`. Point `www.luftek.in` at it once the client signs off.

## Before go-live: confirm with the client

1. **UniFlow airflow**: the luftek.in homepage says 1,000–80,000 CFM, but the product page says 1,000–42,000 CFM. The site uses 42,000.
2. **Bengaluru address**: the About page (George Thangaiah Complex) and the Contact page (OM Chambers, Binnamangala) disagree. The site uses the Contact page address.
3. **Factory PIN**: 631 901 (About) vs 631 701 (Contact). It's left off the page until confirmed.
4. **Reference names**: "Stellis Pharma" is shown as "Stelis Biopharma". "Kindorama Hospital" is kept as on their site, but the photo signage reads "Kinder".
5. **Enquiry form** opens a pre-filled email to sales@luftek.in. For lead capture into a CRM, wire it to an n8n webhook.
6. **Brochure PDFs** exist on the old site per product. Add the links in `main.js` once the client supplies the final files.
