# Marvice AI Studio on aistudio.marvice.tech

Deploys [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT), a
self-hosted AI image, video, lip sync, cinema and workflow studio, branded as
**Marvice AI Studio**, at `https://aistudio.marvice.tech`.

## Prerequisites
- DNS `A` record for `aistudio.marvice.tech` pointing at the server (91.108.110.216)
- Ports 80/443 open, root access. Docker is installed if missing.
- A [Muapi.ai API key](https://muapi.ai/access-keys) for whoever generates. The app is
  bring-your-own-key: each user pastes their key in the browser, where it is stored in
  localStorage and sent only to Muapi. Nothing is configured on the server.

## Install / update
```bash
git clone https://github.com/marvice-2019/Marvice---calude.git
cd Marvice---calude/deploy/open-generative-ai
sudo DOMAIN=aistudio.marvice.tech EMAIL=yuvarajgs@marvice.in bash install.sh
```
Re-run it to pull the latest upstream and redeploy. The first build takes a few minutes.

| Variable | Default | |
|---|---|---|
| `BASIC_AUTH` | `on` | `off` makes the studio public (users still need their own Muapi key) |
| `BASIC_AUTH_USER` | `admin` | Password file: `/etc/open-generative-ai/htpasswd` |
| `APP_REF` | `main` | Upstream branch, tag or commit to deploy |
| `APP_PORT` | `3001` | Host port the container is published on |

## What it does
1. Clones the upstream repo **with its submodules** to `/opt/Open-Generative-AI`
2. Builds `open-generative-ai:latest` from the `Dockerfile` here. It is the upstream build
   plus branding, and the runtime image keeps `packages/`: upstream copies only `node_modules`, whose
   workspace packages are symlinks into `packages/`
3. Brands it while building (`brand/apply.mjs`, run inside the image build, so the
   checkout in `/opt` stays clean):
   - Product name in page titles, header, API-key screen and translations → "Marvice AI Studio"
   - Marvice mark (`brand/marvice-mark.svg`) as the header logo, API-key screen logo and favicon
   - Recolours upstream's cyan accent (`#22d3ee` and Tailwind `cyan-*`) to the mark's copper `#bd8b53`
   - Removes upstream's third-party promo banner (vadoo.tv)

   Edits are exact text matches. If upstream changes one of those spots, the build prints
   `brand: no match in ...` and that spot keeps the upstream look. Update `apply.mjs` then.
4. Runs container `open-generative-ai` (`--restart unless-stopped`)
5. Publishes it:
   - **Coolify server** (detected via `/data/coolify/proxy`): the container is published on
     the docker0 gateway and a route is written to
     `/data/coolify/proxy/dynamic/open-generative-ai.yaml` for Coolify's Traefik and its
     Let's Encrypt resolver.
   - **Plain server**: published on `127.0.0.1` behind nginx + certbot.

## Operations
```bash
docker logs -f open-generative-ai      # app logs
docker restart open-generative-ai
```
