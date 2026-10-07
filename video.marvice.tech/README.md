# video.marvice.tech — HyperFrames Studio

Runs [HyperFrames](https://github.com/heygen-com/hyperframes) Studio (the `hyperframes preview` server
with rendering to MP4) on the Coolify server at **https://video.marvice.tech**, behind basic auth.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 + Chromium + chrome-headless-shell + ffmpeg + `hyperframes` CLI |
| `entrypoint.sh` | Creates a project in `/projects` on first boot, then serves Studio on port 3002 |
| `docker-compose.yml` | Coolify Docker Compose resource: `studio` (private) + `auth` (public) and a persistent volume |
| `Dockerfile.auth`, `Caddyfile`, `auth-entrypoint.sh` | Caddy basic-auth gate; the only service exposed to the internet |

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

## Updating

Bump `HYPERFRAMES_VERSION`, then redeploy. Projects persist in the `hyperframes-projects` volume.
