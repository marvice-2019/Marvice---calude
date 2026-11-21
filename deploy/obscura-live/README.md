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
npm install && npm test          # 5 regression tests against a fake upstream browser
bash build-inline-dockerfile.sh > /tmp/Dockerfile.inline
# Coolify UI: obscura-live-gateway → Configuration → Dockerfile, paste the file, Deploy
```
`Dockerfile` and `build-inline-dockerfile.sh` must stay in step: both pin `node:22-alpine` by digest and
install from `package-lock.json` with `npm ci`.

## Hardening
- **Container:** Coolify runs it with `--read-only --tmpfs /tmp --cap-drop=ALL --security-opt=no-new-privileges`
  as the non-root `node` user.
- **Agent paths:** WebSocket upgrades must match `/devtools/<segment>[/<segment>…][?query]`. Anything with `#`
  or `..` is refused.
- **Slow viewers:** a viewer more than 2 MB behind skips frames until it catches up. At most 20 viewers can
  connect at once.
- **Stuck captures:** a capture upstream doesn't answer within `CAPTURE_TIMEOUT_MS` (10 s) is dropped, so the
  tile keeps updating.
- **Id clashes:** if an agent uses a CDP id a pending capture holds, the gateway sends it under a fresh id and
  restores the original on the reply.
- **Last-resort handlers:** they log uncaught errors instead of dropping every session.

## Security review (2026-11-21)
An independent review found two high-severity issues, plus three medium and low ones. All five are fixed,
and each has a regression test in `test/gateway.test.mjs` that fails with its fix removed:

| Finding | Severity | Test |
|---|---|---|
| Unauthenticated upgrade + TCP reset crashed the process | High | `reset mid-reply` |
| Stalled viewer buffered frames without limit (276 MB in 4 s in the test) | High | `stalled viewer` |
| `#` in an agent path threw inside the upgrade callback | Medium | `# in the path` |
| Agent ids ≥ 2,000,000,000 could have their replies swallowed | Medium | `id clashes` |
| An unanswered capture froze a tile forever | Low | `never answers` |

Open items:
- **Cloudflare SSL:** the zone is in *Full* mode. A configuration rule that sets *Full (strict)* for
  `browser.marvice.tech` only is pending. The origin has a valid Let's Encrypt certificate, so it is safe.
- **Origin exposure:** the DNS-only live host reveals the origin IP, so the CDP host can be reached without
  going through Cloudflare. The token still applies. Restricting the `browser` router to Cloudflare IP ranges
  in Traefik would close this.
- **Forgeable log IPs:** `CF-Connecting-IP` in the logs can be forged by clients that bypass Cloudflare.

## Known limits
- **Idle sessions:** Cloudflare may close idle WebSocket connections on `browser.marvice.tech` after about
  100 seconds. The viewer sends keepalives, but agents should not sit idle.
- **Bandwidth:** each frame is about 50–70 KB, so watching from a phone uses roughly 60 KB/s per open page.
- **Login throttling:** the gateway doesn't limit failed logins itself. `browser.marvice.tech` is behind
  Cloudflare; the live host relies on a long random password.
