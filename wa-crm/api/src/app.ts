import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { FetchLike } from './meta.js';
import { noopRealtime, type Realtime } from './realtime.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes, razorpayWebhookRoutes } from './routes/billing.js';
import { LimitError } from './limits.js';
import { contactRoutes } from './routes/contacts.js';
import { inboxRoutes } from './routes/inbox.js';
import { campaignRoutes } from './routes/campaigns.js';
import { integrationRoutes } from './routes/integrations.js';
import { hashKey } from './integrations.js';
import { signToken } from './auth.js';
import { flowRoutes } from './routes/flows.js';
import { teamRoutes } from './routes/team.js';
import { templateRoutes } from './routes/templates.js';
import { webhookRoutes } from './routes/webhook.js';

/** AppDeps with every optional dependency resolved. Route plugins receive this. */
export type Deps = AppDeps & { realtime: Realtime };

export interface AppDeps {
  config: Config;
  db: Db;
  fetch: FetchLike;
  /** Live inbox events; defaults to a no-op (tests, workers). */
  realtime?: Realtime;
}

export async function buildApp(input: AppDeps): Promise<FastifyInstance> {
  const deps: Deps = { ...input, realtime: input.realtime ?? noopRealtime };
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]', 'req.headers["x-razorpay-signature"]'] },
    trustProxy: true,
  });

  // Must be set before routes are registered, or plugins keep Fastify's default handler.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof LimitError) {
      return reply.code(402).send({ error: 'plan_limit', resource: err.resource, limit: err.limit, used: err.used });
    }
    req.log.error({ err }, 'unhandled error');
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    return reply.code(500).send({ error: 'internal_error' });
  });

  // Only the configured web app origins may call the API from a browser. Webhooks are server-to-server.
  await app.register(cors, { origin: deps.config.WEB_ORIGINS.length ? deps.config.WEB_ORIGINS : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['authorization', 'content-type'], maxAge: 600 });
  await app.register(rateLimit, { global: false });

  // API keys (x-api-key) act as an admin of their workspace, but only on integration-safe paths:
  // a leaked key cannot touch team, billing, settings or other keys.
  const KEY_PATHS = /^\/(contacts|conversations|templates|campaigns|tags|waba)(\/|\?|$)/;
  app.addHook('onRequest', async (req, reply) => {
    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || req.headers.authorization) return;
    if (!KEY_PATHS.test(req.url)) return reply.code(403).send({ error: 'api_key_not_allowed_here' });
    const r = await deps.db.query<{ tenant_id: string; created_by: string | null }>(
      'UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 AND revoked_at IS NULL RETURNING tenant_id, created_by', [hashKey(key)]);
    const k = r.rows[0];
    if (!k?.created_by) return reply.code(401).send({ error: 'invalid_api_key' });
    req.headers.authorization = `Bearer ${await signToken({ userId: k.created_by, tenantId: k.tenant_id, role: 'admin' }, deps.config.JWT_SECRET)}`;
  });

  app.get('/health', async () => {
    await deps.db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes(deps));
  await app.register(contactRoutes(deps));
  await app.register(inboxRoutes(deps));
  await app.register(templateRoutes(deps));
  await app.register(teamRoutes(deps));
  await app.register(campaignRoutes(deps));
  await app.register(flowRoutes(deps));
  await app.register(integrationRoutes(deps));
  await app.register(webhookRoutes(deps));
  await app.register(billingRoutes(deps));
  await app.register(razorpayWebhookRoutes(deps));
  await app.register(adminRoutes(deps));


  return app;
}
