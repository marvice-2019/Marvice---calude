# Beyond Conceptz website

Seven-page static website for Beyond Conceptz, residential architects and builders in Chennai and Kanchipuram. Built by Marvice Media.

Pages: Home, About, Services, Collections (pricing and budget planner), Process, Projects, Contact.

## Structure

| Path | What it is |
| --- | --- |
| `src/` | Page sections and shared SVG defs (logo mark, icons) |
| `assets/` | `site.css`, `site.js` (menu, planner, form), `model.js` (three.js 3D house), favicon |
| `img/` | Photos generated in Canva, to be replaced with real project photos |
| `build.py` | Assembles every page from the shared header, footer and sections |
| `dist/` | Built, deploy-ready site: upload its contents to `public_html` |

## Build

```bash
python3 build.py
```

Outputs `dist/` (full HTML documents for hosting) and `artifact/` (preview build, not committed).

## Before launch

- Confirm the collection rates and specifications in `assets/site.js` (`TIERS`) with the client. They are indicative.
- Add a phone or WhatsApp number.
- Connect the enquiry form to a backend, for example an n8n webhook. It currently prepares an email.
- Replace the generated photos in `img/` with real project photos, keeping the same file names.

## Hosting

Coolify on the Marvice VPS, project `beyondconceptz`. `Dockerfile` serves `dist/` with nginx (`nginx.conf`); www and beyondconceptz.in redirect to https://beyondconceptz.com. After editing `src/` or `assets/`, run `python3 build.py`, commit `dist/` and redeploy in Coolify.
