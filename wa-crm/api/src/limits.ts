import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Tx } from './db.js';

export type LimitedResource = 'contacts' | 'agents' | 'whatsapp_numbers' | 'ai_replies_month';

export class LimitError extends Error {
  constructor(public resource: LimitedResource, public limit: number, public used: number) {
    super(`plan limit reached for ${resource}`);
  }
}

/**
 * Throws LimitError if adding `adding` more of `resource` would pass the tenant's plan limit.
 * Must run inside withTenant. No limit row for the plan (or no plan) = unlimited.
 * Two simultaneous requests can each pass the check and overshoot by one; acceptable for plan limits.
 */
export async function assertWithinLimit(tx: Tx, resource: LimitedResource, adding = 1): Promise<void> {
  const r = await tx.query<{ max_value: number; used: string }>('SELECT max_value, used FROM tenant_limit_usage($1)', [resource]);
  const row = r.rows[0];
  if (!row) return;
  const used = Number(row.used);
  if (used + adding > row.max_value) throw new LimitError(resource, row.max_value, used);
}

/** preHandler: blocks a suspended tenant (unpaid) from working routes. Billing and login stay open. */
export function requireActiveTenant(db: Db) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.principal?.tenantId;
    if (!tenantId) return;
    const r = await db.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
    if (r.rows[0]?.status !== 'active') return reply.code(402).send({ error: 'account_suspended' });
  };
}
