# OpenMontage — aivideo.marvice.tech

[OpenMontage](https://github.com/calesthio/OpenMontage) runs on the Coolify server at **https://aivideo.marvice.tech**,
behind basic auth. The site shows **Backlot**, OpenMontage's live storyboard: each video project, its scenes,
assets, approvals and renders, updating as the agent works.

OpenMontage has no "type a prompt" form. Videos are made by an AI coding agent (Claude Code, included in the image)
that you run from the container terminal; progress shows up live on the site.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 + Python 3.11 + FFmpeg + Chromium libs + Claude Code; clones OpenMontage at `OPENMONTAGE_REF` and runs the same steps as `make setup` (Python deps, Piper TTS, Remotion, HyperFrames) |
| `docker-compose.yml` | Coolify Docker Compose resource: `openmontage` (private) + `auth` (public) and two persistent volumes |
| `Dockerfile.auth`, `Caddyfile`, `auth-entrypoint.sh` | Caddy basic-auth gate; the only service exposed to the internet |

## 1. DNS

`aivideo.marvice.tech` already has an `A` record pointing at the Coolify server (91.108.110.216).

## 2. Coolify

1. **Projects → + New → Resource → Public/Private Repository**, repo `marvice-2019/Marvice---calude`, branch with this folder.
2. Build pack: **Docker Compose**. Base directory: `/aivideo.marvice.tech`. Compose file: `/docker-compose.yml`.
3. Under the **`auth`** service, set **Domains** to `https://aivideo.marvice.tech:8080`. Leave `openmontage` with no domain.
   The `:8080` sets the container port; Traefik still serves the site on 443 with a Let's Encrypt certificate.
4. **Environment Variables**: `BASIC_AUTH_USER` (default `admin`) and `BASIC_AUTH_PASSWORD` (required; the deploy
   fails without it).
5. Optional provider keys (each unlocks more tools; everything works without them using free/local tools):
   `FAL_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`.
6. **Deploy**. The first build takes several minutes.

> ⚠️ Keep basic auth on. Backlot serves every project's files and has no login of its own.

If `deploy/openmontage/install.sh` was run on this server earlier, remove its route so it doesn't clash:
`rm -f /data/coolify/proxy/dynamic/openmontage.yaml` and `systemctl disable --now openmontage-backlot`.

## 3. Making a video

1. In Coolify, open the resource → **Terminal**, pick the **`openmontage`** container.
2. Run:
   ```bash
   cd /opt/OpenMontage
   claude
   ```
   The first time, Claude Code asks you to log in (Claude account or API key). The login is kept in the
   `openmontage-home` volume, so you only do it once.
3. Describe the video, e.g. *"Make a 60-second animated explainer about how solar panels work."*
4. Watch and approve it on https://aivideo.marvice.tech. Finished videos are saved under `/data/projects/<project>/`.

## Updating

Set `OPENMONTAGE_REF` (a commit or tag of OpenMontage) in Environment Variables and redeploy. Projects persist in the
`openmontage-projects` volume.

OpenMontage is AGPLv3.
