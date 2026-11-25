import { createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import type { FetchLike } from '../src/meta.js';
import { migrate } from '../scripts/migrate.js';

// TEST_DATABASE_URL points at a server where we may create throwaway databases.
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres?host=/tmp';

export const APP_SECRET = 'test-app-secret';
export const VERIFY_TOKEN = 'verify-token-123';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  sent: { url: string; method: string; headers: Record<string, string>; body: unknown }[];
  setMetaResponse: (r: { ok: boolean; status: number; body: unknown }) => void;
  close: () => Promise<void>;
}

export async function setup(extra: Record<string, string> = {}): Promise<TestCtx> {
  const name = `wacrm_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/postgres(\?|$)/, `/${name}$1`);
  await migrate(url, () => {});

  const config = loadConfig({
    DATABASE_URL: url,
    JWT_SECRET: 'x'.repeat(40),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    META_APP_SECRET: APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    LOG_LEVEL: 'silent',
    ...extra,
  });
  const db = createPool(url);
  const sent: TestCtx['sent'] = [];
  let metaResponse = { ok: true, status: 200, body: { messages: [{ id: 'wamid.OUT1' }] } as unknown };
  const fetchFn: FetchLike = async (u, init) => {
    sent.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = metaResponse;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
  const app = await buildApp({ config, db, fetch: fetchFn });
  return {
    app, db, sent,
    setMetaResponse: (r) => { metaResponse = r; },
    close: async () => {
      await app.close();
      await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

export async function signup(app: FastifyInstance, email: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { businessName: `Biz ${email}`, name: 'Owner', email, password: 'correct-horse-1' } });
  if (r.statusCode !== 201) throw new Error(`signup failed: ${r.body}`);
  return r.json() as { token: string; tenantId: string };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export function signedWebhook(body: unknown) {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } };
}

export function inboundText(phoneNumberId: string, from: string, wamid: string, text: string) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '911234567890', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: 'Priya' }, wa_id: from }],
    messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
  } }] }] };
}

export function statusUpdate(phoneNumberId: string, wamid: string, status: string) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '911234567890', phone_number_id: phoneNumberId },
    statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '919999999999' }],
  } }] }] };
}

export async function connectNumber(app: FastifyInstance, token: string, phoneNumberId: string, wabaId: string) {
  const r = await app.inject({ method: 'POST', url: '/waba/connect', headers: bearer(token), payload: {
    metaWabaId: wabaId, accessToken: 'EAAG' + 'x'.repeat(40), phoneNumberId, displayPhone: '+91 12345 67890' } });
  if (r.statusCode !== 201) throw new Error(`connect failed: ${r.body}`);
}
