import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { encryptSecret } from '../crypto.js';
import { withTenant } from '../db.js';
import { enqueue } from '../jobs.js';
import { requireActiveTenant } from '../limits.js';
import { SHOP_DOMAIN, SHOPIFY_QUEUE, ShopifyError, shopInfo } from '../shopify.js';
import type { Deps } from '../app.js';

const connectBody = z.object({
  shopDomain: z.string().trim().toLowerCase().transform((s) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).pipe(z.string().regex(SHOP_DOMAIN)),
  accessToken: z.string().trim().min(20).max(200),
});

export const shopifyRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  app.addHook('preHandler', requireRole('owner', 'admin'));

  app.get('/integrations/shopify', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => {
    const c = (await tx.query('SELECT shop_domain, shop_name, currency, last_synced_at, last_result FROM shopify_connections')).rows[0];
    return c ? { connected: true, ...c } : { connected: false };
  }));

  // Checks the token against the store before saving it, then starts the first sync.
  app.put('/integrations/shopify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = connectBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', hint: 'shop domain looks like yourstore.myshopify.com' });
    const tenantId = req.principal!.tenantId;
    let info;
    try { info = await shopInfo(deps.fetch, deps.config.SHOPIFY_API_VERSION, b.data.shopDomain, b.data.accessToken); }
    catch (err) { if (err instanceof ShopifyError) return reply.code(400).send({ error: 'shopify_rejected', detail: err.message }); throw err; }
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO shopify_connections (tenant_id, shop_domain, token_enc, shop_name, currency) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET shop_domain = $2, token_enc = $3, shop_name = $4, currency = $5, last_result = NULL`,
        [tenantId, b.data.shopDomain, encryptSecret(b.data.accessToken, deps.config.TOKEN_ENCRYPTION_KEY), info.name, info.currencyCode]);
      await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'shopify.connected', $3)",
        [tenantId, req.principal!.userId, b.data.shopDomain]);
      await enqueue(tx, SHOPIFY_QUEUE, {}, { tenantId, dedupeKey: `shopify:${tenantId}:connect` });
    });
    return { connected: true, shopName: info.name, currency: info.currencyCode };
  });

  app.post('/integrations/shopify/sync', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const tenantId = req.principal!.tenantId;
    const ok = await withTenant(deps.db, tenantId, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM shopify_connections')).rowCount) return false;
      await enqueue(tx, SHOPIFY_QUEUE, {}, { tenantId, dedupeKey: `shopify:${tenantId}:manual` });
      return true;
    });
    if (!ok) return reply.code(404).send({ error: 'not_connected' });
    return reply.code(202).send({ queued: true });
  });

  // Products already imported stay (hidden ones stay hidden); only the link and token are removed.
  app.delete('/integrations/shopify', async (req) => {
    await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query('DELETE FROM shopify_connections'));
    return { connected: false };
  });
};
