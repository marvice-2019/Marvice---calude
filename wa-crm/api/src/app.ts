import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { FetchLike } from './meta.js';
import { authRoutes } from './routes/auth.js';
import { contactRoutes } from './routes/contacts.js';
import { inboxRoutes } from './routes/inbox.js';
import { webhookRoutes } from './routes/webhook.js';

export interface AppDeps {
  config: Config;
  db: Db;
  fetch: FetchLike;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]'] },
    trustProxy: true,
  });

  await app.register(rateLimit, { global: false });

  app.get('/health', async () => {
    await deps.db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes(deps));
  await app.register(contactRoutes(deps));
  await app.register(inboxRoutes(deps));
  await app.register(webhookRoutes(deps));

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'unhandled error');
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}
