import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { decryptSecret } from '../crypto.js';
import { withTenant } from '../db.js';
import { requireActiveTenant } from '../limits.js';
import { createTemplate, listTemplates, MetaApiError, sendTemplate } from '../meta.js';
import type { Deps } from '../app.js';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'DRAFT'] as const;
const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;

/** Variable numbers used in a body text, e.g. "Hi {{1}}, order {{2}}" → [1, 2]. */
export function variableNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

const component = z.object({ type: z.string().toUpperCase() }).passthrough();
const createBody = z.object({
  wabaAccountId: z.string().uuid(),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, 'lowercase letters, digits and underscores only'),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
  category: z.enum(CATEGORIES),
  components: z.array(component).min(1).max(10),
}).superRefine((b, ctx) => {
  const body = b.components.find((c) => c.type === 'BODY');
  const text = body && typeof body.text === 'string' ? body.text : null;
  if (!text) { ctx.addIssue({ code: 'custom', message: 'a BODY component with text is required', path: ['components'] }); return; }
  if (text.length > 1024) ctx.addIssue({ code: 'custom', message: 'body text is longer than 1024 characters', path: ['components'] });
  const nums = variableNumbers(text);
  if (nums.some((n, i) => n !== i + 1)) {
    ctx.addIssue({ code: 'custom', message: 'variables must be numbered {{1}}, {{2}}, ... with no gaps', path: ['components'] });
  }
});

const sendBody = z.object({ templateId: z.string().uuid(), parameters: z.array(z.string().max(1024)).max(20).default([]) });

export const templateRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const key = deps.config.TOKEN_ENCRYPTION_KEY, ver = deps.config.META_GRAPH_VERSION;

  app.post('/templates', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    const b = body.data, p = req.principal!;
    const waba = await withTenant(deps.db, p.tenantId, async (tx) => (await tx.query<{ meta_waba_id: string; token: string }>(
      'SELECT meta_waba_id, access_token_enc AS token FROM waba_accounts WHERE id = $1', [b.wabaAccountId])).rows[0]);
    if (!waba) return reply.code(404).send({ error: 'waba_not_found' });

    let created: { id: string; status: string };
    try {
      created = await createTemplate(deps.fetch, ver, waba.meta_waba_id, decryptSecret(waba.token, key),
        { name: b.name, language: b.language, category: b.category, components: b.components });
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      req.log.warn({ status: err.status, detail: err.detail }, 'meta template create failed');
      return reply.code(502).send({ error: 'meta_error', code: (err.detail as { code?: unknown } | null)?.code ?? err.status });
    }
    const status = (STATUSES as readonly string[]).includes(created.status) ? created.status : 'PENDING';
    const row = await withTenant(deps.db, p.tenantId, async (tx) => (await tx.query(
      `INSERT INTO message_templates (tenant_id, waba_account_id, meta_template_id, name, language, category, components, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, waba_account_id, name, language)
       DO UPDATE SET meta_template_id = EXCLUDED.meta_template_id, category = EXCLUDED.category,
                     components = EXCLUDED.components, status = EXCLUDED.status, rejected_reason = NULL
       RETURNING id, name, language, category, status, meta_template_id`,
      [p.tenantId, b.wabaAccountId, created.id, b.name, b.language, b.category, JSON.stringify(b.components), status])).rows[0]);
    return reply.code(201).send(row);
  });

  app.post('/templates/sync', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const p = req.principal!;
    const wabas = await withTenant(deps.db, p.tenantId, async (tx) => (await tx.query<{ id: string; meta_waba_id: string; token: string }>(
      'SELECT id, meta_waba_id, access_token_enc AS token FROM waba_accounts')).rows);
    const fetched: { wabaAccountId: string; t: Awaited<ReturnType<typeof listTemplates>>[number] }[] = [];
    try {
      for (const w of wabas) {
        for (const t of await listTemplates(deps.fetch, ver, w.meta_waba_id, decryptSecret(w.token, key))) {
          fetched.push({ wabaAccountId: w.id, t });
        }
      }
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      return reply.code(502).send({ error: 'meta_error' });
    }
    let upserted = 0, skipped = 0;
    await withTenant(deps.db, p.tenantId, async (tx) => {
      for (const { wabaAccountId, t } of fetched) {
        // Statuses or categories we don't model yet (e.g. IN_APPEAL) are skipped, not guessed.
        if (!(STATUSES as readonly string[]).includes(t.status) || !(CATEGORIES as readonly string[]).includes(t.category)
            || !/^[a-z0-9_]{1,512}$/.test(t.name)) { skipped++; continue; }
        await tx.query(
          `INSERT INTO message_templates (tenant_id, waba_account_id, meta_template_id, name, language, category, components, status, rejected_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, waba_account_id, name, language)
           DO UPDATE SET meta_template_id = EXCLUDED.meta_template_id, category = EXCLUDED.category,
                         components = EXCLUDED.components, status = EXCLUDED.status, rejected_reason = EXCLUDED.rejected_reason`,
          [p.tenantId, wabaAccountId, String(t.id), t.name, t.language, t.category, JSON.stringify(t.components ?? []),
           t.status, t.status === 'REJECTED' ? (t.rejected_reason ?? null) : null]);
        upserted++;
      }
    });
    return { upserted, skipped };
  });

  app.get('/templates', async (req) => {
    const status = z.enum(STATUSES).optional().safeParse((req.query as { status?: string }).status);
    return withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
      `SELECT id, waba_account_id, name, language, category, status, rejected_reason, components, updated_at
         FROM message_templates WHERE $1::text IS NULL OR status = $1 ORDER BY name, language`,
      [status.success ? status.data ?? null : null])).rows }));
  });

  // The only way to start or resume a chat outside the 24-hour window.
  app.post('/conversations/:id/template-messages', async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const body = sendBody.safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const p = req.principal!;
    const ctx = await withTenant(deps.db, p.tenantId, async (tx) => {
      const c = (await tx.query<{ to: string; meta_phone_number_id: string; token: string; waba_account_id: string }>(
        `SELECT ct.phone_e164 AS to, pn.meta_phone_number_id, w.access_token_enc AS token, pn.waba_account_id
           FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
           JOIN phone_numbers pn ON pn.id = c.phone_number_id JOIN waba_accounts w ON w.id = pn.waba_account_id
          WHERE c.id = $1 AND ($2 <> 'agent' OR c.assigned_user_id = $3)`, [id.data, p.role, p.userId])).rows[0];
      if (!c) return null;
      const t = (await tx.query<{ name: string; language: string; status: string; components: { type: string; text?: string }[] }>(
        'SELECT name, language, status, components FROM message_templates WHERE id = $1 AND waba_account_id = $2',
        [body.data.templateId, c.waba_account_id])).rows[0];
      return { c, t };
    });
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!ctx.t) return reply.code(404).send({ error: 'template_not_found' });
    if (ctx.t.status !== 'APPROVED') return reply.code(422).send({ error: 'template_not_approved', status: ctx.t.status });

    const bodyText = ctx.t.components.find((c) => c.type?.toUpperCase() === 'BODY')?.text ?? '';
    const expected = variableNumbers(bodyText).length, params = body.data.parameters;
    if (params.length !== expected) return reply.code(400).send({ error: 'parameter_count', expected, got: params.length });
    const rendered = bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '');
    const components = expected ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [];
    const payload = { name: ctx.t.name, language: ctx.t.language, components };

    let wamid: string | null = null, errorCode: string | null = null;
    try {
      wamid = await sendTemplate(deps.fetch, ver, ctx.c.meta_phone_number_id, decryptSecret(ctx.c.token, key), ctx.c.to, payload);
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      req.log.error({ status: err.status, detail: err.detail }, 'meta template send failed');
      errorCode = String((err.detail as { code?: unknown } | null)?.code ?? err.status);
    }
    const saved = await withTenant(deps.db, p.tenantId, async (tx) => {
      const m = await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, payload, wa_message_id, status, error_code, sent_by_user_id)
         VALUES ($1, $2, 'outbound', 'template', $3, $4, $5, $6, $7, $8)
         RETURNING id, direction, type, body, status, error_code, created_at`,
        [p.tenantId, id.data, rendered, JSON.stringify(payload), wamid, wamid ? 'sent' : 'failed', errorCode, p.userId]);
      const c = await tx.query<{ assigned_user_id: string | null }>(
        'UPDATE conversations SET last_message_at = now() WHERE id = $1 RETURNING assigned_user_id', [id.data]);
      return { message: m.rows[0], assignee: c.rows[0]?.assigned_user_id ?? null };
    });
    deps.realtime.conversation(p.tenantId, saved.assignee, 'message.created', { conversationId: id.data, message: saved.message });
    return reply.code(wamid ? 201 : 502).send(saved.message);
  });
};
