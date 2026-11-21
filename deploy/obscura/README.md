# Obscura on the Coolify VPS

[Obscura](https://github.com/h4ckf0r0day/obscura) is a headless browser written in Rust that speaks the
Chrome DevTools Protocol (CDP). Puppeteer and Playwright connect to it the same way they connect to headless
Chrome.

Obscura itself runs **internal only**. Agents reach it through the watch-through gateway in
[`../obscura-live`](../obscura-live/README.md), which holds the public domains and adds the live view.

```
agent / n8n ──wss──> browser.marvice.tech ──> obscura-live-gateway ──ws──> obscura-cdp:9222 (Obscura)
phone / laptop ─https─> live.browser.marvice.tech ──> same gateway (live frames, password)
```

## Live deployment
| Item | Value |
|---|---|
| Coolify project / app | `obscura` / `obscura` (app UUID `lr1qlo5jdgdazshe9canuwvp`) |
| Server | 91.108.110.216 |
| Image | `h4ckf0r0day/obscura:0.2.7` (pinned) |
| Network alias | `obscura-cdp` on Coolify's network: internal address `ws://obscura-cdp:9222/devtools/browser` |
| Public domain | none (moved to the gateway) |
| Memory limit | 1 GB |

Coolify doesn't register an app's UUID as a hostname on its network. That's why the app has an explicit
network alias (`custom_network_aliases = obscura-cdp`). Containers on the same server reach Obscura by that
name.

## Authentication
Every request needs `Authorization: Bearer <OBSCURA_CDP_TOKEN>`. The token is stored in Coolify on both
`obscura` and `obscura-live-gateway` under Environment Variables, and the two values must match. To rotate it,
change both, then redeploy both.

## Connect
Public, through the gateway (agents, scripts, laptop):
```js
// Playwright (npm i playwright-core)
const browser = await chromium.connectOverCDP('wss://browser.marvice.tech/devtools/browser', {
  headers: { Authorization: `Bearer ${process.env.OBSCURA_CDP_TOKEN}` },
});

// Puppeteer (npm i puppeteer-core)
const browser = await puppeteer.connect({
  browserWSEndpoint: 'wss://browser.marvice.tech/devtools/browser',
  headers: { Authorization: `Bearer ${process.env.OBSCURA_CDP_TOKEN}` },
});
```

From n8n on the same server you can skip Cloudflare with `ws://obscura-cdp:9222/devtools/browser`, but sessions
opened that way **don't show up in the live view**. Use the public address when you want to watch.

## Obscura quirks we hit
- **Host check:** Obscura only accepts a `Host` header that names its own port. Behind Traefik it refused
  every request with `403 request refused`. `OBSCURA_CDP_FORWARDED_HOST/PORT` only works for loopback workers
  and made the container crash-loop. The gateway connects on `obscura-cdp:9222`, so the header matches and no
  rewrite is needed any more.
- **No health check:** the image ships without one, so Coolify shows the status as `running:unknown`.
- **Upgrades:** change the image tag in Coolify, then redeploy. The tag is pinned on purpose.
