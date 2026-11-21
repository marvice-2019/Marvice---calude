# Obscura watch-through gateway and live view

A small Node service in front of [Obscura](../obscura/README.md). It does two jobs:

1. **CDP gateway** on `browser.marvice.tech`: it checks the bearer token and relays every CDP message to
   Obscura unchanged, so Puppeteer, Playwright, n8n and agents work as if they were talking to Obscura directly.
2. **Live view** on `live.browser.marvice.tech`: it shows every page agents have open, refreshed about once a
   second, behind a username and password.

Obscura can only capture frames through the connection that drives the page; a separate viewer can't attach to
an agent's session. So the gateway sits on that connection. It sends its own `Page.captureScreenshot` commands
(ids from 2,000,000,000 up) and drops the replies before they reach the agent. Screenshots are taken only
while someone has the viewer open, so there's no extra load otherwise.

## Live deployment
| Item | Value |
|---|---|
| Coolify project / app | `obscura` / `obscura-live-gateway` (app UUID `mi2akusa7h8jhepsnoam4zwh`) |
| Domains | `https://browser.marvice.tech` (Cloudflare proxied), `https://live.browser.marvice.tech` (DNS only, Let's Encrypt) |
| Build | Coolify "Dockerfile" build pack, using the inline Dockerfile from `build-inline-dockerfile.sh` |
| Port | 8080 (`ports_exposes` and `PORT` must both be 8080) |
| Memory limit | 512 MB |
| Health check | `GET /healthz` |

`live.browser.marvice.tech` is DNS-only because Cloudflare's free certificate covers only one subdomain level
(`*.marvice.tech`). Traefik issues its certificate with Let's Encrypt instead.

## Environment variables (Coolify → obscura-live-gateway → Environment Variables)
| Key | Value |
|---|---|
| `UPSTREAM` | `ws://obscura-cdp:9222` |
| `OBSCURA_CDP_TOKEN` | same value as on the `obscura` app |
| `VIEWER_USER` | `marvice` |
| `VIEWER_PASSWORD` | random, 24 characters, stored only in Coolify |
| `LIVE_HOST` | `live.browser.marvice.tech` |
| `PUBLIC_WS_BASE` | `wss://browser.marvice.tech` |
| `PORT` | `8080` |
| `CAPTURE_MS` / `JPEG_QUALITY` | optional, default `1000` / `50` |

## Using the live view
Open https://live.browser.marvice.tech, sign in with `VIEWER_USER` / `VIEWER_PASSWORD`, and leave it open. Each
page an agent opens through `browser.marvice.tech` appears as a tile with its URL; tap a tile to enlarge it.
Tiles disappear when the agent closes the page.

Anyone with the viewer password sees every site the agents visit, including logged-in pages. Share it only
with people who should see that.

## Updating the code
```bash
cd deploy/obscura-live
bash build-inline-dockerfile.sh > /tmp/Dockerfile.inline
# Coolify UI: obscura-live-gateway → Configuration → Dockerfile, paste the file, Deploy
```

Local test against any Obscura instance:
```bash
npm install
UPSTREAM=wss://browser.marvice.tech OBSCURA_CDP_TOKEN=... VIEWER_USER=me VIEWER_PASSWORD=change-me-1234567 \
LIVE_HOST=live.local PUBLIC_WS_BASE=wss://browser.marvice.tech PORT=8091 node server.mjs
curl -u me:change-me-1234567 -H 'Host: live.local' localhost:8091/   # viewer page
```

## Verified on 2026-11-21
- Requests without a token or with a wrong one get 401, over HTTP and WebSocket; a valid token gets 200 and
  discovery returns `wss://browser.marvice.tech/devtools/browser`.
- The viewer returns 401 without the password or with a wrong one, and 200 with the right one. The live host
  refuses CDP upgrades.
- A raw CDP session through `wss://browser.marvice.tech` loaded `https://example.com` and returned a
  screenshot, while the viewer received 14 live frames and the gone events when the page closed.

## Known limits
- **Idle sessions:** Cloudflare may close idle WebSocket connections on `browser.marvice.tech` after about
  100 seconds. The viewer sends keepalives, but agents should not sit idle.
- **Bandwidth:** each frame is about 50–70 KB, so watching from a phone uses roughly 60 KB/s per open page.
- **Login throttling:** the gateway doesn't limit failed logins itself. `browser.marvice.tech` is behind
  Cloudflare; the live host relies on a long random password.
