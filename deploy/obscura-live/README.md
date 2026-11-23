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

## Using it from Claude Code (personal use)
This setup is only for our own machines; the service is not offered publicly. Claude Code connects through
the [Playwright MCP server](https://github.com/microsoft/playwright-mcp), which drives Obscura over CDP via
this gateway, so every Claude Code session also shows up in the live view.

One-time setup on each Mac or Linux machine (needs Node 18+ and Claude Code):
```bash
bash deploy/obscura-live/claude-code/setup-obscura-mcp.sh   # paste the CDP token when asked
```
The script:
1. Checks the token against `browser.marvice.tech` and stops if it isn't accepted, without writing anything.
2. Writes `~/.config/obscura-mcp/config.json` (mode 600) with `browser.cdpEndpoint`,
   `browser.cdpHeaders.Authorization` and an `outputDir` for screenshots.
3. Registers it for all projects with
   `claude mcp add obscura --scope user -- npx -y @playwright/mcp@latest --config <that file>`.

Then start a new Claude Code session, run `/mcp` to confirm `obscura` is connected, and ask, for example,
"Use the obscura browser to open example.com and tell me the page title".

- **Token placement:** the token lives only in that local file. It never goes into the repo or a shell
  command line.

### Cloud Claude Code sessions (claude.ai/code)
The repo's `.mcp.json` has an `obscura` entry, enabled in `.claude/settings.json`, that runs
`deploy/obscura-live/claude-code/obscura-mcp.sh`. To turn it on:
1. In the cloud environment's settings (environment menu in the session title bar → Edit), add an environment
   variable `OBSCURA_CDP_TOKEN` with the token from Coolify.
2. Start a new session. `obscura` is then available as a browser tool, and its sessions show up in the live
   view.

How the wrapper picks its config:
- **`OBSCURA_CDP_TOKEN` set (cloud sessions):** it writes a temporary config (mode 600) and deletes it when the
  server stops.
- **Variable not set (our own machines):** it falls back to `~/.config/obscura-mcp/config.json` from the setup
  script above, so the project entry also works on a Mac where setup has been run.
- **Neither available:** the server fails to start with a message saying which one to set up.
- **Rotating the token:** re-run the script on each machine after you change it in Coolify.
- **Not yet verified end to end:** a local hook in the cloud session that wrote this blocks running browser
  automation, so the MCP server was never run against Obscura there. The gateway path itself was verified
  with a raw CDP session, and the script was dry-run with a stand-in `claude` command. The first `/mcp`
  check on a real machine is the end-to-end test.

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
- **Cloudflare SSL (closed 2026-11-21):** a Cloudflare Configuration Rule sets *Full (strict)* for
  `browser.marvice.tech` only (`http.host eq "browser.marvice.tech"`, ruleset `de441644324d4c70aa6d83722b9f9256`).
  The rest of the zone stays in *Full* mode. Verified after the change: requests through Cloudflare returned
  200/401 as expected, a full agent session ran, and there were no 526 errors. If the origin certificate ever
  lapses, this host returns 526 until Traefik renews it.
- **Origin exposure (partly closed 2026-11-21):** the DNS-only live host reveals the origin IP. The
  `browser.marvice.tech` routes now accept only Cloudflare source IPs (see "Cloudflare-only browser routes"
  below). That still admits any traffic from Cloudflare's network, such as WARP users, not just this zone's
  proxy. Authenticated Origin Pulls (mTLS between Cloudflare and Traefik) would close this fully.
- **Forgeable log IPs:** `CF-Connecting-IP` in the logs can be forged by clients that bypass Cloudflare.

## Cloudflare-only browser routes
Traefik's `browser.marvice.tech` routes (`http-0-…` and `https-0-…`) carry an `ipallowlist` middleware named
`cf-only`, holding Cloudflare's published ranges (22 ranges, from `GET https://api.cloudflare.com/client/v4/ips`,
2026-11-21). Direct requests to the origin IP with `Host: browser.marvice.tech` get 403 from any non-Cloudflare
address. The live host is not restricted, because it is DNS-only by design.

```
traefik.http.middlewares.cf-only.ipallowlist.sourcerange=<Cloudflare IPv4 and IPv6 ranges, comma-separated>
traefik.http.routers.http-0-mi2akusa7h8jhepsnoam4zwh.middlewares=redirect-to-https,cf-only
traefik.http.routers.https-0-mi2akusa7h8jhepsnoam4zwh.middlewares=gzip-sse,cf-only
```

- **Hand-edited labels:** they live in Coolify → obscura-live-gateway → Configuration → Container Labels, and
  label auto-generation is off for this app. If you change either domain, update the router names and rules by
  hand.
- **Stale ranges:** Cloudflare rarely changes its ranges. If they change, `browser.marvice.tech` starts
  returning 403 for some visitors. Refresh the `sourcerange` from the API above.
- **Verification:** the server runs Traefik v3 (`ipallowlist`). A deny-all list returned 403 both through
  Cloudflare and direct. Removing the range a test client came from turned its 401 into 403.
- **Testing caveat:** tests from a sandbox whose outbound traffic leaves through Cloudflare (162.158.0.0/15)
  are allowed, as designed. Test from a normal ISP or VPS connection instead.

## Known limits
- **Idle sessions:** Cloudflare may close idle WebSocket connections on `browser.marvice.tech` after about
  100 seconds. The viewer sends keepalives, but agents should not sit idle.
- **Bandwidth:** each frame is about 50–70 KB, so watching from a phone uses roughly 60 KB/s per open page.
- **Login throttling:** the gateway doesn't limit failed logins itself. `browser.marvice.tech` is behind
  Cloudflare; the live host relies on a long random password.
