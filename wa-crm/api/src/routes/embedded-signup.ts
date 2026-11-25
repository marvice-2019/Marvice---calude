import { randomInt } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { encryptSecret } from '../crypto.js';
import { withTenant } from '../db.js';
import { assertWithinLimit, requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

// Meta Embedded Signup: the browser runs FB.login with our configuration id and gets back a short-lived
// code plus the WABA id and phone number id the customer picked. We finish the setup server-side.
// Endpoints as documented by Meta for Embedded Signup; confirm against the current docs before go-live.
const body = z.object({
  code: z.string().min(10).max(2000),
  wabaId: z.string().regex(/^\d{5,30}$/),
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
});

type Obj = Record<string, unknown>;

export const embeddedSignupRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const c = deps.config;
  const graph = (path: string) => `https://graph.facebook.com/${c.META_GRAPH_VERSION}/${path}`;

  // What the browser needs to open the popup. Not secret.
  app.get('/waba/embedded-signup/config', async () => ({
    enabled: !!(c.META_APP_ID && c.META_ES_CONFIG_ID), appId: c.META_APP_ID ?? null, configId: c.META_ES_CONFIG_ID ?? null,
    graphVersion: c.META_GRAPH_VERSION,
  }));

  app.post('/waba/embedded-signup', { preHandler: requireRole('owner', 'admin'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!c.META_APP_ID || !c.META_ES_CONFIG_ID) return reply.code(503).send({ error: 'embedded_signup_not_configured' });
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!, { code, wabaId, phoneNumberId } = b.data;
    await withTenant(deps.db, p.tenantId, (tx) => assertWithinLimit(tx, 'whatsapp_numbers'));

    const call = async (step: string, url: string, init: { method: string; body?: Obj; token?: string }) => {
      const res = await deps.fetch(url, { method: init.method,
        headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined });
      const data = (await res.json().catch(() => ({}))) as Obj;
      if (!res.ok) {
        req.log.warn({ step, status: res.status, error: data.error }, 'embedded signup step failed');
        const e = new Error(step) as Error & { meta: unknown };
        e.meta = (data.error as Obj | undefined)?.message ?? `HTTP ${res.status}`;
        throw e;
      }
      return data;
    };

    try {
      // 1. Code → business integration token for this customer's WABA.
      const q = new URLSearchParams({ client_id: c.META_APP_ID, client_secret: c.META_APP_SECRET, code });
      const tok = await call('exchange_code', `${graph('oauth/access_token')}?${q}`, { method: 'GET' });
      const token = String(tok.access_token ?? '');
      if (!token) throw Object.assign(new Error('exchange_code'), { meta: 'no access token returned' });
      // 2. Subscribe our app to the WABA so its messages reach our webhook.
      await call('subscribe_app', graph(`${wabaId}/subscribed_apps`), { method: 'POST', token });
      // 3. Register the number for Cloud API with a two-step verification PIN we generate.
      const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await call('register_number', graph(`${phoneNumberId}/register`), { method: 'POST', token, body: { messaging_product: 'whatsapp', pin } });
      // 4. Details for display.
      const info = await call('number_details', `${graph(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { method: 'GET', token });

      const out = await withTenant(deps.db, p.tenantId, async (tx) => {
        const w = await tx.query<{ id: string }>(
          `INSERT INTO waba_accounts (tenant_id, meta_waba_id, access_token_enc) VALUES ($1, $2, $3)
           ON CONFLICT (meta_waba_id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc
             WHERE waba_accounts.tenant_id = EXCLUDED.tenant_id
           RETURNING id`, [p.tenantId, wabaId, encryptSecret(token, c.TOKEN_ENCRYPTION_KEY)]);
        if (!w.rowCount) return null;   // this WABA belongs to another workspace
        await tx.query(
          `INSERT INTO phone_numbers (tenant_id, waba_account_id, meta_phone_number_id, display_phone, verified_name, quality_rating)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (meta_phone_number_id) DO UPDATE SET display_phone = EXCLUDED.display_phone, verified_name = EXCLUDED.verified_name,
             quality_rating = EXCLUDED.quality_rating WHERE phone_numbers.tenant_id = EXCLUDED.tenant_id`,
          [p.tenantId, w.rows[0]!.id, phoneNumberId, String(info.display_phone_number ?? phoneNumberId),
           (info.verified_name as string | undefined) ?? null, (info.quality_rating as string | undefined) ?? null]);
        await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'waba.embedded_signup', $3)", [p.tenantId, p.userId, wabaId]);
        return { displayPhone: info.display_phone_number ?? null, verifiedName: info.verified_name ?? null };
      });
      if (!out) return reply.code(409).send({ error: 'already_connected' });
      return reply.code(201).send({ ok: true, ...out });
    } catch (err) {
      const e = err as Error & { meta?: unknown };
      if (e.meta === undefined) throw err;
      return reply.code(502).send({ error: 'meta_error', step: e.message, detail: String(e.meta).slice(0, 300) });
    }
  });
};
