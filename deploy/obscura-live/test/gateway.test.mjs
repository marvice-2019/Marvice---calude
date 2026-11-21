// Regression tests for the gateway, run against a fake upstream browser.
// Run: cd deploy/obscura-live && npm install && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';

const SERVER = process.env.GATEWAY_SERVER || fileURLToPath(new URL('../server.mjs', import.meta.url));
const TOKEN = 't'.repeat(40);
const USER = 'viewer';
const PASS = 'p'.repeat(20);
const LIVE = 'live.test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake Obscura: answers attach with session S1; capture behaviour is set per test.
async function startUpstream({ capture = () => ({ data: 'AAAA' }) } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  let captures = 0;
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Target.attachToTarget') {
        ws.send(JSON.stringify({ id: msg.id, result: { sessionId: 'S1' } }));
      } else if (msg.method === 'Page.captureScreenshot') {
        const n = ++captures;
        const out = await capture(n);
        if (out && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result: out }));
      } else {
        ws.send(JSON.stringify({ id: msg.id, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}), result: { echo: msg.method } }));
      }
    });
  });
  await new Promise((r) => wss.once('listening', r));
  return { port: wss.address().port, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }) };
}

async function startGateway(upstreamPort, extraEnv = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = {
    ...process.env, PORT: String(port), UPSTREAM: `ws://127.0.0.1:${upstreamPort}`, OBSCURA_CDP_TOKEN: TOKEN,
    VIEWER_USER: USER, VIEWER_PASSWORD: PASS, LIVE_HOST: LIVE, PUBLIC_WS_BASE: 'wss://browser.test', ...extraEnv,
  };
  const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d; });
  proc.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 50 && !logs.includes('gateway listening'); i++) await sleep(50);
  assert.ok(logs.includes('gateway listening'), `gateway did not start:\n${logs}`);
  return {
    port, proc,
    logs: () => logs,
    rssMb: () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${proc.pid}/status`, 'utf8'))[1]) / 1024,
    stop: () => new Promise((r) => { proc.once('exit', r); proc.kill('SIGKILL'); }),
  };
}

const healthy = (port) => new Promise((resolve) => {
  http.get({ port, path: '/healthz' }, (res) => { res.resume(); resolve(res.statusCode === 200); }).on('error', () => resolve(false));
});

async function agent(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/browser`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const inbox = [];
  ws.on('message', (m) => inbox.push(JSON.parse(m.toString())));
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  ws.send(JSON.stringify({ id: 1, method: 'Target.attachToTarget', params: { targetId: 'T1', flatten: true } }));
  for (let i = 0; i < 40 && !inbox.some((m) => m.id === 1); i++) await sleep(25);
  return { ws, inbox };
}

function viewer(port) {
  const frames = [];
  const req = http.get({ port, path: '/events', headers: { Host: LIVE, Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => { for (const m of chunk.matchAll(/event: frame/g)) frames.push(m); });
  });
  req.on('error', () => {});
  return { frames, close: () => req.destroy() };
}

test('an unauthenticated upgrade reset mid-reply does not crash the gateway', async () => {
  const up = await startUpstream();
  const gw = await startGateway(up.port);
  try {
    for (let i = 0; i < 40; i++) {
      const s = net.connect(gw.port, '127.0.0.1', () => {
        s.write('GET /devtools/browser HTTP/1.1\r\nHost: browser.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
          + 'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
        s.resetAndDestroy();
      });
      s.on('error', () => {});
    }
    await sleep(500);
    assert.ok(await healthy(gw.port), 'gateway stopped answering');
    assert.ok(!gw.logs().includes('uncaught exception'), `socket error escaped:\n${gw.logs()}`);
  } finally { await gw.stop(); await up.close(); }
});

test('an authenticated upgrade with a # in the path is refused without an uncaught error', async () => {
  const up = await startUpstream();
  const gw = await startGateway(up.port);
  try {
    const reply = await new Promise((resolve) => {
      const s = net.connect(gw.port, '127.0.0.1', () => {
        s.write(`GET /devtools/x#y HTTP/1.1\r\nHost: browser.test\r\nAuthorization: Bearer ${TOKEN}\r\nUpgrade: websocket\r\n`
          + 'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
      });
      let buf = '';
      s.on('data', (d) => { buf += d; });
      s.on('close', () => resolve(buf));
      s.on('error', () => resolve(buf));
      setTimeout(() => s.destroy(), 1000);
    });
    await sleep(200);
    assert.ok(await healthy(gw.port), 'gateway stopped answering');
    assert.ok(!gw.logs().includes('uncaught exception'), `relay error escaped:\n${gw.logs()}`);
    assert.match(reply, /^HTTP\/1\.1 404/, `expected 404, got: ${reply.slice(0, 80)}`);
  } finally { await gw.stop(); await up.close(); }
});

test('a stalled viewer does not make the gateway buffer frames without limit', async () => {
  const bigFrame = 'A'.repeat(1024 * 1024);
  const up = await startUpstream({ capture: () => ({ data: bigFrame }) });
  const gw = await startGateway(up.port, { CAPTURE_MS: '20' });
  const sock = net.connect(gw.port, '127.0.0.1');
  try {
    const { ws } = await agent(gw.port);
    await sleep(300);
    const before = gw.rssMb();
    sock.write(`GET /events HTTP/1.1\r\nHost: ${LIVE}\r\nAuthorization: Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}\r\n\r\n`);
    sock.pause(); // never read: the viewer's TCP window fills up
    await sleep(4000);
    const growth = gw.rssMb() - before;
    ws.close();
    assert.ok(growth < 80, `gateway memory grew ${growth.toFixed(0)} MB for one stalled viewer`);
  } finally { sock.destroy(); await gw.stop(); await up.close(); }
});

test('an agent command whose id clashes with a pending capture still gets its reply', async () => {
  // Captures answer slowly, so the first injected id (2,000,000,000) is still pending when the agent reuses it.
  const up = await startUpstream({ capture: async () => { await sleep(1500); return { data: 'AAAA' }; } });
  const gw = await startGateway(up.port, { CAPTURE_MS: '50' });
  const v = viewer(gw.port);
  try {
    const { ws, inbox } = await agent(gw.port);
    await sleep(200);
    ws.send(JSON.stringify({ id: 2_000_000_000, method: 'Echo.test' }));
    for (let i = 0; i < 40 && !inbox.some((m) => m.id === 2_000_000_000); i++) await sleep(25);
    const reply = inbox.find((m) => m.id === 2_000_000_000);
    ws.close();
    assert.deepEqual(reply?.result, { echo: 'Echo.test' }, 'agent reply was swallowed or mangled');
  } finally { v.close(); await gw.stop(); await up.close(); }
});

test('a capture upstream never answers does not freeze the tile', async () => {
  // The first capture is dropped; later ones are answered.
  const up = await startUpstream({ capture: (n) => (n === 1 ? null : { data: 'AAAA' }) });
  const gw = await startGateway(up.port, { CAPTURE_MS: '50', CAPTURE_TIMEOUT_MS: '300' });
  const v = viewer(gw.port);
  try {
    const { ws } = await agent(gw.port);
    for (let i = 0; i < 80 && v.frames.length === 0; i++) await sleep(25);
    ws.close();
    assert.ok(v.frames.length > 0, 'no frame arrived after the dropped capture');
  } finally { v.close(); await gw.stop(); await up.close(); }
});

test('a browser opening the CDP address is sent to the live view; API requests are not', async () => {
  const up = await startUpstream();
  const gw = await startGateway(up.port);
  const get = (path, headers) => new Promise((resolve) => {
    http.get({ port: gw.port, path, headers: { Host: 'browser.test', ...headers } }, (res) => { res.resume(); resolve(res); });
  });
  try {
    const html = 'text/html,application/xhtml+xml,*/*;q=0.8';
    const page = await get('/', { Accept: html });
    assert.equal(page.statusCode, 302);
    assert.equal(page.headers.location, `https://${LIVE}/`);
    assert.equal((await get('/', { Accept: 'application/json' })).statusCode, 401, 'non-browser root must stay 401');
    assert.equal((await get('/json/version', { Accept: html })).statusCode, 401, 'discovery must stay 401');
    assert.equal((await get('/', { Accept: html, Authorization: 'Bearer nope' })).statusCode, 401, 'requests carrying a token must not redirect');
  } finally { await gw.stop(); await up.close(); }
});
