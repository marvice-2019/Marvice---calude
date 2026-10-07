# video.marvice.tech — HyperFrames Studio

Runs [HyperFrames](https://github.com/heygen-com/hyperframes) Studio (the `hyperframes preview` server
with rendering to MP4) on the Coolify server at **https://video.marvice.tech**, behind basic auth.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 + Chromium + chrome-headless-shell + ffmpeg + `hyperframes` CLI |
| `entrypoint.sh` | Creates a project in `/projects` on first boot, then serves Studio on port 3002 |
| `docker-compose.yml` | Coolify Docker Compose resource: persistent volume and a Traefik basic-auth middleware |

## 1. DNS (Hostinger)

In hPanel → Domains → `marvice.tech` → DNS, add:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `video` | public IP of the Coolify server | 300 |

## 2. Coolify

1. **Projects → + New → Resource → Public/Private Repository**, repo `marvice-2019/Marvice---calude`.
2. Build pack: **Docker Compose**. Base directory: `/video.marvice.tech`. Compose file: `/docker-compose.yml`.
3. Under the `studio` service, set **Domains** to `https://video.marvice.tech:3002`. The `:3002` sets the
   container port; Traefik still serves the site on 443 with a Let's Encrypt certificate.
4. **Environment Variables**: add `BASIC_AUTH_USERS`. Generate it with:

   ```bash
   htpasswd -nbB admin 'choose-a-strong-password'   # e.g. admin:$2y$05$...
   ```

   Paste the output as-is. If Coolify interpolates `$`, double every `$` (`$$2y$$05$$...`).
5. Optional: `HYPERFRAMES_VERSION` (default `0.8.140`) and `HYPERFRAMES_PROJECT` (default `studio`).
6. **Deploy**. The first build takes several minutes because it downloads Chromium.

> ⚠️ Keep basic auth on. Studio's API reads, writes, and deletes project files and starts renders
> without any login of its own (upstream security note F-001).

If Coolify generated a different router name than `https-0-studio`, check the deployed container's
labels and update the `traefik.http.routers.<name>.middlewares` label to match.

## Updating

Bump `HYPERFRAMES_VERSION`, then redeploy. Projects persist in the `hyperframes-projects` volume.
