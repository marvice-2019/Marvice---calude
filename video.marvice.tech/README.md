# Marvice Studio — video.marvice.tech

Marvice Studio runs on the Coolify server at **https://video.marvice.tech**, behind basic auth:

- **https://video.marvice.tech/create**: Marvice Studio, which turns a typed prompt into an MP4 (see below).
- **https://video.marvice.tech/**: the video editor, [HyperFrames](https://github.com/heygen-com/hyperframes) Studio
  (the `hyperframes preview` server with rendering to MP4). Its own interface keeps the HyperFrames name.

The logo files in `creator/public/` (`marvice-logo.svg`, `marvice-mark.svg`) are cropped from `marvice_R_logo.ai`.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 + Chromium + chrome-headless-shell + ffmpeg + `hyperframes` CLI |
| `entrypoint.sh` | Creates a project in `/projects` on first boot, then serves Studio on port 3002 |
| `docker-compose.yml` | Coolify Docker Compose resource: `studio` (private) + `auth` (public) and a persistent volume |
| `Dockerfile.auth`, `Caddyfile`, `auth-entrypoint.sh` | Caddy basic-auth gate; the only service exposed to the internet. Routes `/create*` to `creator`, everything else to `studio` |
| `creator/` | Prompt-to-video service at `/create` (runs from the `studio` image with the `creator` command) |

## 1. DNS (Hostinger)

In hPanel → Domains → `marvice.tech` → DNS, add:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `video` | public IP of the Coolify server | 300 |

## 2. Coolify

1. **Projects → + New → Resource → Public/Private Repository**, repo `marvice-2019/Marvice---calude`.
2. Build pack: **Docker Compose**. Base directory: `/video.marvice.tech`. Compose file: `/docker-compose.yml`.
3. Under the **`auth`** service, set **Domains** to `https://video.marvice.tech:8080`. Leave `studio` with no domain.
   The `:8080` sets the container port; Traefik still serves the site on 443 with a Let's Encrypt certificate.
4. **Environment Variables**: `BASIC_AUTH_USER` (default `admin`) and `BASIC_AUTH_PASSWORD` (required; the deploy
   fails without it). The password is hashed with bcrypt when the container starts.
5. Optional: `HYPERFRAMES_VERSION` (default `0.8.140`) and `HYPERFRAMES_PROJECT` (default `studio`).
6. **Deploy**. The first build takes several minutes because it downloads Chromium.

> ⚠️ Keep basic auth on. Studio's API reads, writes, and deletes project files and starts renders
> without any login of its own (upstream security note F-001).

## Marvice Studio: prompt to video (`/create`)

At https://video.marvice.tech/create you type what the video should show, pick a size and a length, and get an MP4:

1. An AI writer turns the prompt into a HyperFrames composition (`index.html`).
2. If AI footage is selected, the writer first plans one shot per 8 seconds (up to 3) and a video model films them.
3. `hyperframes lint` checks the composition; errors go back to the writer once for a fix.
4. `hyperframes render` makes the MP4. Jobs run one at a time.

Sizes: Reel 9:16 (1080×1920), Landscape 16:9 (1920×1080), Square 1:1 (1080×1080), Portrait 4:5 (1080×1350).
Each video is saved in `/projects/creations/<id>/` and can be downloaded (MP4 or HTML) or opened in Studio.
**Edit in Studio** replaces the Studio project's `index.html` and `assets/` after copying the old project to `/projects/.studio-backups/`.

Add any of these in Coolify (Environment Variables), then redeploy. Each key switches its provider on:

| Variable | Turns on | Optional model override |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude writer | `ANTHROPIC_MODEL` (default `claude-opus-5-5`) |
| `OPENAI_API_KEY` | OpenAI writer and Sora footage | `OPENAI_MODEL` (default `gpt-5`), `SORA_MODEL` (default `sora-2`), `OPENAI_BASE_URL` for an OpenAI-compatible service |
| `GEMINI_API_KEY` | Gemini writer and Veo footage | `GEMINI_MODEL` (default `gemini-2.5-pro`), `VEO_MODEL` (default `veo-3.0-generate-001`) |
| `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` | Any other model on OpenRouter | — |

Veo and Sora make 16:9 or 9:16 clips; square and 4:5 videos crop them. Generated footage is billed by the provider per second.

## Updating

Bump `HYPERFRAMES_VERSION`, then redeploy. Projects persist in the `hyperframes-projects` volume.
