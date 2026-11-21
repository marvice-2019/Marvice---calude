// Obscura watch-through gateway.
// Agents connect here instead of to Obscura. Every CDP message is relayed unchanged; the gateway
// also captures screenshots of each agent page over the same upstream connection and streams them
// to a password-protected viewer on LIVE_HOST.
import http from 'node:http';
import crypto from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing env ${name}`);
  return value;
};

const PORT = Number(env('PORT', '8080'));
const UPSTREAM = env('UPSTREAM').replace(/\/$/, ''); // e.g. ws://obscura:9222
const TOKEN = env('OBSCURA_CDP_TOKEN');
const VIEWER_USER = env('VIEWER_USER');
const VIEWER_PASSWORD = env('VIEWER_PASSWORD');
const LIVE_HOST = env('LIVE_HOST').toLowerCase();
const PUBLIC_WS_BASE = env('PUBLIC_WS_BASE').replace(/\/$/, ''); // e.g. wss://browser.example.com
const CAPTURE_MS = Number(env('CAPTURE_MS', '1000'));
const JPEG_QUALITY = Number(env('JPEG_QUALITY', '50'));
const CAPTURE_TIMEOUT_MS = Number(env('CAPTURE_TIMEOUT_MS', '10000'));
const MAX_PAYLOAD = 256 * 1024 * 1024;
const INJECT_BASE = 2_000_000_000; // ids the gateway uses for its own CDP commands
const VIEWER_BUFFER_LIMIT = 2 * 1024 * 1024; // a viewer this far behind skips frames until it drains
const MAX_VIEWERS = 20;
// Agent WebSocket paths: /devtools/browser, /devtools/page/<id>, with an optional query. No '#', no '..'.
const DEVTOOLS_PATH = /^\/devtools\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*(\?[^#]*)?$/;

if (TOKEN.length < 32) throw new Error('OBSCURA_CDP_TOKEN must be at least 32 characters');
if (VIEWER_PASSWORD.length < 16) throw new Error('VIEWER_PASSWORD must be at least 16 characters');

const log = (...args) => console.log(new Date().toISOString(), ...args);
const digest = (s) => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const hostOf = (req) => (req.headers.host || '').split(':')[0].toLowerCase();
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;

function bearerOk(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') && safeEqual(header.slice(7), TOKEN);
}

function viewerOk(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  const userOk = safeEqual(decoded.slice(0, split), VIEWER_USER);
  const passOk = safeEqual(decoded.slice(split + 1), VIEWER_PASSWORD);
  return userOk && passOk;
}

// ---------- viewer (SSE) ----------
const viewers = new Set();

function broadcast(event, payload) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of viewers) {
    // A stalled viewer (e.g. a backgrounded phone tab) must not make the gateway buffer frames without limit.
    if (event === 'frame' && res.writableLength > VIEWER_BUFFER_LIMIT) continue;
    res.write(chunk);
  }
}

setInterval(() => { for (const res of viewers) res.write(': keepalive\n\n'); }, 20_000).unref();

// ---------- CDP relay ----------
const connections = new Map();
let connCounter = 0;

class Relay {
  constructor(client, req) {
    this.id = ++connCounter;
    this.client = client;
    this.ip = clientIp(req);
    this.sessions = new Map(); // sessionId -> { targetId, url, title, frame, pending, errors, pausedUntil }
    this.injected = new Map(); // injected id -> { sessionId, at }
    this.agentIds = new Set(); // agent ids >= INJECT_BASE still awaiting a reply; never reused for injection
    this.remap = new Map(); // gateway id -> agent's original id, when an agent id clashed with a pending capture
    this.attachRequests = new Map(); // client id -> targetId for Target.attachToTarget
    this.nextInjectId = INJECT_BASE;
    this.queue = [];
    this.upstream = new WebSocket(UPSTREAM + req.url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      perMessageDeflate: false,
      maxPayload: MAX_PAYLOAD,
    });

    this.upstream.on('open', () => {
      for (const [data, isBinary] of this.queue) this.upstream.send(data, { binary: isBinary });
      this.queue = [];
    });
    this.upstream.on('message', (data, isBinary) => this.fromUpstream(data, isBinary));
    this.upstream.on('close', (code) => this.closeBoth(code));
    this.upstream.on('error', (err) => { log(`conn ${this.id} upstream error:`, err.message); this.closeBoth(1011); });

    client.on('message', (data, isBinary) => this.fromClient(data, isBinary));
    client.on('close', (code) => this.closeBoth(code));
    client.on('error', (err) => { log(`conn ${this.id} client error:`, err.message); this.closeBoth(1011); });

    connections.set(this.id, this);
    log(`conn ${this.id} open from ${this.ip} path=${req.url}`);
  }

  freshId() {
    let id = this.nextInjectId++;
    while (this.agentIds.has(id) || this.injected.has(id) || this.remap.has(id)) id = this.nextInjectId++;
    return id;
  }

  fromClient(data, isBinary) {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (typeof msg.id === 'number' && msg.id >= INJECT_BASE) {
          if (this.injected.has(msg.id)) {
            // The agent picked an id a capture is using: send it under a fresh id and restore it on reply.
            const original = msg.id;
            msg.id = this.freshId();
            this.remap.set(msg.id, original);
            data = JSON.stringify(msg);
          } else {
            this.agentIds.add(msg.id);
          }
        }
        if (msg.method === 'Target.attachToTarget' && msg.params?.targetId) {
          this.attachRequests.set(msg.id, msg.params.targetId);
        } else if (msg.method === 'Page.navigate' && msg.sessionId && msg.params?.url) {
          const s = this.sessions.get(msg.sessionId);
          if (s) s.url = msg.params.url; // shown until the navigation event confirms it
        }
      } catch { /* not JSON: relay as-is */ }
    }
    if (this.upstream.readyState === WebSocket.OPEN) this.upstream.send(data, { binary: isBinary });
    else if (this.upstream.readyState === WebSocket.CONNECTING) this.queue.push([data, isBinary]);
  }

  fromUpstream(data, isBinary) {
    let msg = null;
    if (!isBinary) {
      try { msg = JSON.parse(data.toString()); } catch { /* relay as-is */ }
    }
    if (msg && typeof msg.id === 'number') {
      if (this.remap.has(msg.id)) {
        const gatewayId = msg.id;
        msg.id = this.remap.get(gatewayId);
        this.remap.delete(gatewayId);
        data = JSON.stringify(msg);
        isBinary = false;
      } else if (this.injected.has(msg.id)) {
        this.onCapture(msg);
        return; // the agent never sees the gateway's own commands
      } else {
        this.agentIds.delete(msg.id);
      }
    }
    if (msg) this.observe(msg);
    if (this.client.readyState === WebSocket.OPEN) this.client.send(data, { binary: isBinary });
  }

  observe(msg) {
    if (typeof msg.id === 'number' && this.attachRequests.has(msg.id)) {
      const targetId = this.attachRequests.get(msg.id);
      this.attachRequests.delete(msg.id);
      if (msg.result?.sessionId) this.addSession(msg.result.sessionId, { targetId, type: 'page' });
      return;
    }
    const p = msg.params || {};
    switch (msg.method) {
      case 'Target.attachedToTarget':
        if (p.targetInfo?.type === 'page') this.addSession(p.sessionId, p.targetInfo);
        break;
      case 'Target.detachedFromTarget':
        this.removeSession(p.sessionId);
        break;
      case 'Target.targetDestroyed':
        for (const [sid, s] of this.sessions) if (s.targetId === p.targetId) this.removeSession(sid);
        break;
      case 'Target.targetInfoChanged':
        for (const s of this.sessions.values()) {
          if (s.targetId === p.targetInfo?.targetId) {
            s.url = p.targetInfo.url || s.url;
            s.title = p.targetInfo.title || s.title;
          }
        }
        break;
      case 'Page.frameNavigated': {
        // Main-frame navigations carry the page's real URL even when target events are off.
        const s = this.sessions.get(msg.sessionId);
        if (s && !p.frame?.parentId) s.url = p.frame?.url || s.url;
        break;
      }
      default:
        break;
    }
  }

  addSession(sessionId, info) {
    if (!sessionId || this.sessions.has(sessionId)) return;
    this.sessions.set(sessionId, {
      targetId: info.targetId, url: info.url || '', title: info.title || '',
      frame: null, pending: false, errors: 0, pausedUntil: 0,
    });
  }

  removeSession(sessionId) {
    if (!this.sessions.delete(sessionId)) return;
    broadcast('gone', { key: `${this.id}:${sessionId}` });
  }

  capture() {
    if (this.upstream.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    // A capture upstream never answered must not freeze that page's tile forever.
    for (const [id, entry] of this.injected) {
      if (now - entry.at < CAPTURE_TIMEOUT_MS) continue;
      this.injected.delete(id);
      const stale = this.sessions.get(entry.sessionId);
      if (stale) stale.pending = false;
    }
    for (const [sessionId, s] of this.sessions) {
      if (s.pending || s.pausedUntil > now) continue;
      const id = this.freshId();
      s.pending = true;
      this.injected.set(id, { sessionId, at: now });
      this.upstream.send(JSON.stringify({
        id, sessionId, method: 'Page.captureScreenshot',
        params: { format: 'jpeg', quality: JPEG_QUALITY },
      }));
    }
  }

  onCapture(msg) {
    const { sessionId } = this.injected.get(msg.id);
    this.injected.delete(msg.id);
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.pending = false;
    if (!msg.result?.data) {
      s.errors += 1;
      if (s.errors >= 3) { s.pausedUntil = Date.now() + 5000; s.errors = 0; }
      return;
    }
    s.errors = 0;
    s.frame = msg.result.data;
    broadcast('frame', this.snapshot(sessionId, s));
  }

  snapshot(sessionId, s) {
    return { key: `${this.id}:${sessionId}`, conn: this.id, url: s.url, title: s.title, data: s.frame, at: Date.now() };
  }

  closeBoth(code) {
    if (this.closed) return;
    this.closed = true;
    const safe = code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000;
    for (const sid of [...this.sessions.keys()]) this.removeSession(sid);
    for (const ws of [this.client, this.upstream]) {
      if (ws.readyState === WebSocket.OPEN) ws.close(safe);
      else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    }
    connections.delete(this.id);
    log(`conn ${this.id} closed (${code})`);
  }
}

setInterval(() => {
  if (viewers.size === 0) return; // no one watching: no screenshots, no extra load
  for (const relay of connections.values()) relay.capture();
}, CAPTURE_MS).unref();

// ---------- HTTP ----------
const upstreamHttp = UPSTREAM.replace(/^ws/, 'http');

async function proxyDiscovery(req, res) {
  const r = await fetch(upstreamHttp + req.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = (await r.text()).replace(/wss?:\/\/[^/"]+\/devtools\//g, `${PUBLIC_WS_BASE}/devtools/`);
  res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
  res.end(body);
}

const json = (res, status, obj, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  try {
    if (path === '/healthz') return json(res, 200, { ok: true });

    if (hostOf(req) === LIVE_HOST) {
      if (!viewerOk(req)) {
        return json(res, 401, { error: 'login required' }, { 'WWW-Authenticate': 'Basic realm="Obscura live", charset="UTF-8"' });
      }
      if (path === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
        });
        return res.end(VIEWER_HTML);
      }
      if (path === '/events') {
        if (viewers.size >= MAX_VIEWERS) return json(res, 503, { error: 'too many viewers' });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        for (const relay of connections.values()) {
          for (const [sid, s] of relay.sessions) if (s.frame) res.write(`event: frame\ndata: ${JSON.stringify(relay.snapshot(sid, s))}\n\n`);
        }
        viewers.add(res);
        log(`viewer joined from ${clientIp(req)} (${viewers.size} watching)`);
        req.on('close', () => { viewers.delete(res); log(`viewer left (${viewers.size} watching)`); });
        return;
      }
      return json(res, 404, { error: 'not found' });
    }

    if (!bearerOk(req)) return json(res, 401, { error: 'authentication required' });
    if (req.method === 'GET' && /^\/json(\/version|\/list)?\/?$/.test(path)) return await proxyDiscovery(req, res);
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    log('http error:', err.message);
    if (!res.headersSent) json(res, 502, { error: 'upstream unavailable' });
    else res.end();
  }
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_PAYLOAD });

server.on('upgrade', (req, socket, head) => {
  // Node drops its own socket error handler once 'upgrade' fires; without this a client that resets
  // mid-reply raises an uncaught ECONNRESET and kills the process.
  socket.on('error', () => socket.destroy());
  const reject = (status, text) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"error":"${text.toLowerCase()}"}`);
  };
  if (hostOf(req) === LIVE_HOST) return reject(404, 'Not Found');
  if (!bearerOk(req)) { log(`rejected unauthenticated upgrade from ${clientIp(req)}`); return reject(401, 'Unauthorized'); }
  if (!DEVTOOLS_PATH.test(req.url || '')) return reject(404, 'Not Found');
  wss.handleUpgrade(req, socket, head, (client) => {
    try {
      new Relay(client, req);
    } catch (err) {
      log('relay setup failed:', err.message);
      client.close(1011);
    }
  });
});

// Last resort: log and keep serving the other sessions rather than dropping every agent at once.
process.on('uncaughtException', (err) => log('uncaught exception:', err.stack || err.message));
process.on('unhandledRejection', (err) => log('unhandled rejection:', err?.stack || err));

server.listen(PORT, () => log(`gateway listening on ${PORT}, upstream ${UPSTREAM}, viewer host ${LIVE_HOST}`));

const VIEWER_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0d10">
<title>Obscura Live</title>
<style>
:root{--bg:#0b0d10;--panel:#14181d;--line:#232a32;--text:#e8edf2;--muted:#8a96a3;--live:#3ddc84;--accent:#7cc4ff}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:rgba(11,13,16,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
h1{margin:0;font-size:17px;font-weight:650;letter-spacing:.2px}
.status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:#556}
.dot.on{background:var(--live);box-shadow:0 0 0 0 rgba(61,220,132,.6);animation:pulse 2s infinite}
@keyframes pulse{70%{box-shadow:0 0 0 8px rgba(61,220,132,0)}100%{box-shadow:0 0 0 0 rgba(61,220,132,0)}}
main{padding:16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;cursor:zoom-in}
.tile img{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#000}
.meta{padding:10px 12px;display:grid;gap:2px}
.title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.url{color:var(--accent);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{color:var(--muted);font-size:12px}
.empty{grid-column:1/-1;margin-top:18vh;text-align:center;color:var(--muted);padding:0 16px}
.empty strong{display:block;color:var(--text);font-size:17px;margin-bottom:6px}
#zoom{position:fixed;inset:0;z-index:5;display:none;background:rgba(0,0,0,.94);padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);cursor:zoom-out}
#zoom.open{display:flex;flex-direction:column}
#zoom img{flex:1;min-height:0;width:100%;object-fit:contain}
#zoom .meta{background:var(--panel)}
@media (prefers-reduced-motion:reduce){.dot.on{animation:none}}
</style>
</head><body>
<header><h1>Obscura Live</h1><div class="status"><span class="dot" id="dot"></span><span id="count">Connecting…</span></div></header>
<main id="grid"><div class="empty" id="empty"><strong>No agent sessions right now</strong>Pages appear here as soon as an agent opens one through browser.marvice.tech.</div></main>
<div id="zoom" role="dialog" aria-label="Enlarged session"><img alt=""><div class="meta"><div class="title"></div><div class="url"></div></div></div>
<script>
const grid=document.getElementById('grid'),empty=document.getElementById('empty'),count=document.getElementById('count'),dot=document.getElementById('dot');
const zoom=document.getElementById('zoom'),tiles=new Map();let zoomKey=null;
function host(u){try{return new URL(u).host||u}catch{return u||'about:blank'}}
function render(){const n=tiles.size;empty.style.display=n?'none':'';count.textContent=n?(n+' live session'+(n>1?'s':'')):'Waiting for agents'}
function fill(el,f){el.querySelector('img').src='data:image/jpeg;base64,'+f.data;el.querySelector('.title').textContent=f.title||host(f.url);
  el.querySelector('.url').textContent=f.url||'about:blank';const s=el.querySelector('.sub');if(s)s.textContent='Agent connection #'+f.conn}
function onFrame(f){let t=tiles.get(f.key);
  if(!t){const el=document.createElement('article');el.className='tile';el.innerHTML='<img alt=""><div class="meta"><div class="title"></div><div class="url"></div><div class="sub"></div></div>';
    el.addEventListener('click',()=>{zoomKey=f.key;fill(zoom,tiles.get(f.key).f);zoom.classList.add('open')});grid.appendChild(el);t={el};tiles.set(f.key,t)}
  t.f=f;fill(t.el,f);if(zoomKey===f.key)fill(zoom,f);render()}
function onGone(g){const t=tiles.get(g.key);if(!t)return;t.el.remove();tiles.delete(g.key);if(zoomKey===g.key){zoom.classList.remove('open');zoomKey=null}render()}
zoom.addEventListener('click',()=>{zoom.classList.remove('open');zoomKey=null});
const es=new EventSource('/events');
es.onopen=()=>{dot.classList.add('on');render()};
es.onerror=()=>{dot.classList.remove('on');count.textContent='Reconnecting…'};
es.addEventListener('frame',e=>onFrame(JSON.parse(e.data)));
es.addEventListener('gone',e=>onGone(JSON.parse(e.data)));
</script>
</body></html>`;
