# Marvice Studio — video.marvice.tech

Marvice Studio runs on the Coolify server at **https://video.marvice.tech**, behind basic auth:

- **https://video.marvice.tech/**: Marvice Studio, which turns a typed prompt into an MP4 (see below). Also at `/create`.
- **https://video.marvice.tech/editor**: Marvice Editor Studio, the video editor. It is [HyperFrames](https://github.com/heygen-com/hyperframes)
  Studio (the `hyperframes preview` server with rendering to MP4), rebranded at build time by `studio-brand/`:
  Marvice logo, copper accent, tab title and favicon; the HeyGen Framey button and the project-name label are hidden.

The logo files in `creator/public/` (`marvice-logo.svg`, `marvice-mark.svg`) are cropped from `marvice_R_logo.ai`.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 + Chromium + chrome-headless-shell + ffmpeg + `hyperframes` CLI |
| `entrypoint.sh` | Creates a project in `/projects` on first boot, then serves Studio on port 3002 |
| `docker-compose.yml` | Coolify Docker Compose resource: `studio` (private) + `auth` (public) and a persistent volume |
| `Dockerfile.auth`, `Caddyfile`, `auth-entrypoint.sh` | Caddy basic-auth gate; the only service exposed to the internet. Routes `/` and `/create*` to `creator`, everything else (the editor at `/editor`, its assets and API) to `studio` |
| `creator/` | Prompt-to-video service at `/create` (runs from the `studio` image with the `creator` command) |
| `studio-brand/` | Patches the Studio's `index.html` during the image build (inline logo, CSS and a small script). If a HyperFrames upgrade changes that page, the build stops with a message instead of shipping it unbranded |

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

## Marvice Studio: prompt to video (`/`)

At https://video.marvice.tech/ you type what the video should show, pick a size and a length, and get an MP4:

1. An AI writer turns the prompt into a HyperFrames composition (`index.html`).
2. If AI footage is selected, the writer first plans one shot per 8 seconds (up to 3) and a video model films them.
3. `hyperframes lint` checks the composition; errors go back to the writer once for a fix.
4. `hyperframes render` makes the MP4. Jobs run one at a time.

Sizes: Reel 9:16 (1080×1920), Landscape 16:9 (1920×1080), Square 1:1 (1080×1080), Portrait 4:5 (1080×1350).
Each video is saved in `/projects/creations/<id>/` and can be downloaded (MP4 or HTML) or opened in Studio.
**Edit in Studio** replaces the Studio project's `index.html` and `assets/` after copying the old project to `/projects/.studio-backups/`.

Add any of these in Coolify (Environment Variables), then redeploy. Each key switches its provider on. The **AI writer**
and **AI footage** menus list every provider and model; the ones whose key is missing are greyed out and name the key.

| Variable | AI writer models | AI footage models |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 4.5 | — |
| `OPENAI_API_KEY` | GPT-6.1 Sol, GPT-5.5, GPT-5.4 mini | Sora 2, Sora 2 Pro |
| `GEMINI_API_KEY` | Gemini 3.8 Flash, Gemini 3.1 Pro (needs a paid Gemini plan), Gemini 2.5 Flash | Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite (needs a paid Gemini plan) |
| `XAI_API_KEY` | Grok 4 | Grok Imagine Video |
| `DEEPSEEK_API_KEY` | DeepSeek Chat, DeepSeek Reasoner | — |
| `MISTRAL_API_KEY` | Mistral Large, Mistral Medium | — |
| `FAL_KEY` | — | Kling 3, MiniMax Hailuo 03, Seedance 2.5, Seedance 2.0 Fast (via fal.ai) |
| `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` | Any OpenRouter model you list | — |

To add models to a menu, set `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`, `XAI_MODEL`, `DEEPSEEK_MODEL`,
`MISTRAL_MODEL`, `OPENROUTER_MODEL`, `VEO_MODEL` or `SORA_MODEL` to a model ID or a comma-separated list; those appear
first. `OPENAI_BASE_URL` points the OpenAI writer at an OpenAI-compatible service. `ANTHROPIC_EFFORT` (default `high`) sets
Claude's effort.

Veo, Sora and Grok make 8-second clips, the fal.ai models 10-second clips, up to 3 per video. All clips are 16:9 or 9:16;
square and 4:5 videos crop them. Generated footage is billed by the provider per second.

## Updating

Bump `HYPERFRAMES_VERSION`, then redeploy. Projects persist in the `hyperframes-projects` volume.
