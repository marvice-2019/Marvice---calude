# Open Generative AI on aistudio.marvice.tech

Runs [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT) at **https://aistudio.marvice.tech**
on the Coolify server, behind basic auth. It is the hosted web version (Next.js) with every studio: Image,
Video, Audio, Lip Sync, Cinema, Workflows, Agents, Design Agent and Apps. All generation runs on
[MuAPI](https://muapi.ai), so the app needs a MuAPI key. Local models (sd.cpp, Wan2GP) exist only in the desktop app.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Clones upstream at `OGAI_REF` with its submodules, applies `patches/`, builds and runs `next start` on port 3000 |
| `patches/marvice-server-key.patch` | Adds the optional server-side MuAPI key (`MUAPI_API_KEY`, below) |
| `docker-compose.yml` | Coolify Docker Compose resource: `app` (private) + `auth` (public) |
| `Dockerfile.auth`, `Caddyfile`, `auth-entrypoint.sh` | Caddy basic-auth gate; the only service exposed to the internet |

## 1. DNS (Hostinger)

In hPanel → Domains → `marvice.tech` → DNS, add:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `aistudio` | public IP of the Coolify server (91.108.110.216) | 300 |

## 2. MuAPI key

Create a key at https://muapi.ai/access-keys and add credits. Copy the key value, not its name.

## 3. Coolify

1. **Projects → + New → Resource → Public/Private Repository**, repo `marvice-2019/Marvice---calude`.
2. Build pack: **Docker Compose**. Base directory: `/aistudio.marvice.tech`. Compose file: `/docker-compose.yml`.
3. Under the **`auth`** service, set **Domains** to `https://aistudio.marvice.tech:8080`. Leave `app` with no domain.
   The `:8080` sets the container port; Traefik still serves the site on 443 with a Let's Encrypt certificate.
4. **Environment Variables**:
   - `BASIC_AUTH_PASSWORD` (required; the deploy fails without it) and `BASIC_AUTH_USER` (default `admin`).
   - `MUAPI_API_KEY` (recommended): the company MuAPI key. Nobody is asked for a key; the server adds it to
     every MuAPI call and it never reaches the browser. The balance shown at the top right is this account's.
     Leave it empty to have each user enter their own MuAPI key in the browser instead.
   - Optional: `OGAI_REF`, the upstream commit to build (default `00132ec`, 7 Oct 2026).
5. **Deploy**. The first build takes about 5 minutes.

> ⚠️ Keep basic auth on. With `MUAPI_API_KEY` set, anyone who gets past it spends the company's MuAPI credits.

## How the server key works

With `MUAPI_API_KEY` set, the page stores the placeholder `server-managed` as the browser's key, which skips the
key prompt. The app already sends every MuAPI call through its own `/api/*` routes; the patched `middleware.js`
swaps the placeholder for the real key there, and the server-rendered agent pages do the same. A user who
enters their own key (**Settings → Change key**) keeps using it; reloading the page with no key brings back the
server key.

## Updating

Set `OGAI_REF` to a newer upstream commit and redeploy. If the build fails at `git apply`, upstream changed a
patched file: rebase `patches/marvice-server-key.patch` onto the new commit.
