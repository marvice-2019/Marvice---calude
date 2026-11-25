import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AiError, complete, rewritePrompt, suggestPrompt, transcript, type AiConfig } from '../ai.js';
import { requireAuth, requireRole } from '../auth.js';
import { withTenant } from '../db.js';
import { assertWithinLimit, requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const settingsBody = z.object({ businessContext: z.string().max(4000), tone: z.enum(['friendly', 'formal', 'short']) });
const rewriteBody = z.object({ text: z.string().trim().min(1).max(2000), style: z.enum(['polite', 'shorter', 'fix', 'hindi', 'tamil', 'english']) });

export const aiRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const c = deps.config;
  const cfg: AiConfig | null = c.AI_API_KEY ? {
    provider: c.AI_PROVIDER, apiKey: c.AI_API_KEY, model: c.AI_MODEL,
    baseUrl: c.AI_BASE_URL ?? (c.AI_PROVIDER === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'),
  } : null;
  const rate = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/settings/ai', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({
    configured: !!cfg,
    ...((await tx.query('SELECT business_context, tone FROM ai_settings')).rows[0] ?? { business_context: '', tone: 'friendly' }),
  })));

  app.put('/settings/ai', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const b = settingsBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!;
    await withTenant(deps.db, p.tenantId, (tx) => tx.query(
      `INSERT INTO ai_settings (tenant_id, business_context, tone) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET business_context = EXCLUDED.business_context, tone = EXCLUDED.tone`,
      [p.tenantId, b.data.businessContext, b.data.tone]));
    return { ok: true };
  });

  async function run(tenantId: string, userId: string, kind: 'suggest' | 'rewrite', system: string, user: string) {
    if (!cfg) return { status: 503, body: { error: 'ai_not_configured' } };
    await withTenant(deps.db, tenantId, (tx) => assertWithinLimit(tx, 'ai_replies_month'));
    try {
      const out = await complete(deps.fetch, cfg, system, user);
      await withTenant(deps.db, tenantId, (tx) => tx.query(
        'INSERT INTO ai_requests (tenant_id, user_id, kind, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5)',
        [tenantId, userId, kind, out.inputTokens, out.outputTokens]));
      return { status: 200, body: { text: out.text } };
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      return { status: 502, body: { error: 'ai_provider_error' } };
    }
  }

  app.post('/conversations/:id/suggest-reply', rate, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    const ctx = await withTenant(deps.db, p.tenantId, async (tx) => {
      const ok = await tx.query("SELECT 1 FROM conversations WHERE id = $1 AND ($2 <> 'agent' OR assigned_user_id = $3)", [id.data, p.role, p.userId]);
      if (!ok.rowCount) return null;
      const msgs = (await tx.query<{ direction: string; body: string | null; type: string }>(
        'SELECT direction, body, type FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 15', [id.data])).rows.reverse();
      const s = (await tx.query<{ business_context: string; tone: string }>('SELECT business_context, tone FROM ai_settings')).rows[0];
      const me = (await tx.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [p.userId])).rows[0];
      return { msgs, s, name: me?.name.split(' ')[0] ?? 'the team' };
    });
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!ctx.msgs.some((m) => m.direction === 'inbound')) return reply.code(422).send({ error: 'nothing_to_reply_to' });
    const out = await run(p.tenantId, p.userId, 'suggest', suggestPrompt(ctx.s?.business_context ?? '', ctx.s?.tone ?? 'friendly', ctx.name),
      `${transcript(ctx.msgs)}\nDraft the business's next reply.`);
    return reply.code(out.status).send(out.body);
  });

  app.post('/ai/rewrite', rate, async (req, reply) => {
    const b = rewriteBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body' });
    const out = await run(req.principal!.tenantId, req.principal!.userId, 'rewrite', rewritePrompt(b.data.style), `<text>\n${b.data.text}\n</text>`);
    return reply.code(out.status).send(out.body);
  });
};
