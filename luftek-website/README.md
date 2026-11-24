# Luftek Engineering — website

Multi-page static site for Luftek Engineering Private Limited (AHU / FCU manufacturer, Chennai). Plain HTML, CSS and JS: no framework, no server code.

## Pages (19)

| Page | What's on it |
|---|---|
| `index.html` | Product hero carousel, stats, product families, clickable AHU feature hotspots, unit selector, industries tabs, project rail, plant, certifications |
| `products.html` | Family filter, all 10 products, airflow coverage chart (log scale), unit selector, comparison table |
| `products/*.html` (10) | Gallery with lightbox, key specs, features, technical data, EN 1886 class scale, certification, applications with linked projects, related units |
| `projects.html` | 37 references: sector filter, search, location filter, project detail viewer with previous/next, deep links (`?sector=pharma`, `?p=<id>`) |
| `industries.html` | 7 sectors: what each needs, recommended units, reference projects, jump menu with scroll-spy |
| `about.html` | Story, vision / mission / commitment, interactive timeline 2017–2024, plant, R&D, quality policy (PDF), careers |
| `certifications.html` | 8 standards, AHRI certificate viewer, EN 1886 classes explained |
| `contact.html` | Selection request form (product pre-filled from `?product=`), 6 offices with directions, map |
| `privacy-policy.html` | Working draft under the DPDP Act 2023. **Have a lawyer review before launch.** |
| `404.html` | Branded not-found page (set as the error page in Coolify / nginx) |

Also generated: `sitemap.xml`, `robots.txt` (blocks `/_build/`).

## Editing content

All facts live in `_build/data.py` (products, projects, sectors, offices, timeline). Page templates are in `_build/build.py`. After any change:

```bash
python3 luftek-website/_build/build.py
```

Commit the generated `.html` files: the server only needs the static output.

Type: IBM Plex Sans + IBM Plex Mono (Google Fonts). Colours: Luftek logo slate `#243847`, red `#BF333D`.

## Run locally

```bash
cd luftek-website && python3 -m http.server 8080
```

## Deploy (Coolify)

New resource → Static site → this repo, base directory `luftek-website`, no build command, publish directory `/`. Point `www.luftek.in` at it once the client signs off. The `_build/` folder isn't linked from any page; exclude it from the publish if preferred.

## Before go-live: confirm with the client

1. **UniFlow airflow**: the luftek.in homepage says 1,000–80,000 CFM, but the product page says 1,000–42,000. The site uses 42,000.
2. **Bengaluru address**: the About page (George Thangaiah Complex) and the Contact page (OM Chambers) disagree. The site uses OM Chambers.
3. **Factory PIN**: 631 901 vs 631 701 on their site, so it's left off.
4. **Project names expanded from their labels**: "Olympia" → Olympia Tech Park, "GMR Hyderabad" → Rajiv Gandhi International Airport (GMR), "Hatsun" → Hatsun Agro Product, "KIA" → Kia India, "Stellis Pharma" → Stelis Biopharma. "Kindorama Hospital" is kept as on their site, although the photo signage reads "Kinder".
5. **Brochures**: the "Brochure.pdf" buttons on luftek.in link to nothing. Product pages offer "Ask for datasheet" (email) until real PDFs are supplied.
6. **Sector text** in Industries and the project viewer describes what each sector needs. It doesn't claim which unit went into which project; Luftek can add per-project scope if they share it.
7. **Enquiry form** opens a pre-filled email to sales@luftek.in. For CRM lead capture, wire it to an n8n webhook.
8. **Photography**: all product and project images come from luftek.in. The project photos are low resolution; new site photography would lift the Projects page the most.

## Live preview

Deployed on Coolify at https://luftek.marvice.tech (Dockerfile build pack, base directory `/luftek-website`, branch `claude/admiring-wozniak-ghzrbm`). `nginx.conf` sends `X-Robots-Tag: noindex` for this staging domain: **remove that line when the site moves to luftek.in.**
