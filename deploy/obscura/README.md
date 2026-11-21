# Obscura on the Coolify VPS

[Obscura](https://github.com/h4ckf0r0day/obscura) is a headless browser written in Rust that speaks the
Chrome DevTools Protocol (CDP). Puppeteer and Playwright connect to it the same way they connect to headless
Chrome.

## Live deployment
| Item | Value |
|---|---|
| Public URL | `wss://browser.marvice.tech/devtools/browser` |
| Internal URL (Coolify network) | `ws://lr1qlo5jdgdazshe9canuwvp:9222/devtools/browser` |
| Coolify project / app | `obscura` / `obscura` (app UUID `lr1qlo5jdgdazshe9canuwvp`) |
| Server | 91.108.110.216 |
| Image | `h4ckf0r0day/obscura:0.2.7` (pinned) |
| Memory limit | 1 GB |
| DNS | Cloudflare A record `browser` → 91.108.110.216, proxied |

## Authentication
Every request needs `Authorization: Bearer <OBSCURA_CDP_TOKEN>`. The token is stored only in Coolify:
obscura → Environment Variables. Requests without it, or with a wrong one, get `401 authentication required`.

Anyone holding the token can drive a browser on this server and reach anything the server can reach. Keep the
token in Coolify and n8n credentials only, never in front-end code, and rotate it if it leaks: change the
variable, then redeploy.

## Connect
Connect straight to the WebSocket URL above. Don't use Puppeteer's `browserURL` discovery: it hands back
`ws://browser.marvice.tech:9222/...`, which can't be reached from outside the server.

```js
// Playwright (npm i playwright-core)
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP('wss://browser.marvice.tech/devtools/browser', {
  headers: { Authorization: `Bearer ${process.env.OBSCURA_CDP_TOKEN}` },
});

// Puppeteer (npm i puppeteer-core)
const puppeteer = require('puppeteer-core');
const browser = await puppeteer.connect({
  browserWSEndpoint: 'wss://browser.marvice.tech/devtools/browser',
  headers: { Authorization: `Bearer ${process.env.OBSCURA_CDP_TOKEN}` },
});
```

Health check:
```bash
curl -H "Authorization: Bearer $OBSCURA_CDP_TOKEN" https://browser.marvice.tech/json/version
```

## Why the container labels are edited by hand
Obscura only accepts a `Host` header that names its own port (9222). Behind Traefik the header arrives as
`browser.marvice.tech`, which counts as port 80, so Obscura refused every request with `403 request refused`,
including ones with the right token. Its proxy setting (`OBSCURA_CDP_FORWARDED_HOST/PORT`) only works for
loopback workers and made the container crash-loop.

The fix is a Traefik middleware that rewrites the header before it reaches Obscura:

```
traefik.http.middlewares.obscura-host.headers.customrequestheaders.Host=browser.marvice.tech:9222
traefik.http.routers.https-0-lr1qlo5jdgdazshe9canuwvp.middlewares=gzip-sse,obscura-host
```

Because of this, label auto-generation ("Readonly labels") is turned off for the app. If you change the domain,
update both lines under obscura → Configuration → Container Labels.

## Known limits
- **Idle sessions:** Cloudflare's proxy may close WebSocket connections that sit idle for about 100 seconds.
  Keep long agent sessions active, or use the internal URL from n8n.
- **Health status:** the image has no health check, so Coolify shows the status as `running:unknown`.
- **Upgrades:** change the image tag in Coolify, then redeploy. The tag is pinned on purpose.
