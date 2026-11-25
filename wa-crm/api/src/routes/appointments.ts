import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { bookSlot, BookingError, formatWhen, listFreeSlots, loadSettings } from '../booking.js';
import { withTenant } from '../db.js';
import { requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const settingsBody = z.object({
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } },
    'unknown time zone'),
  hours: z.partialRecord(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, 'closing time must be after opening time')).max(4)),
  slotMinutes: z.number().int().min(5).max(480),
  capacity: z.number().int().min(1).max(100),
  minNoticeMinutes: z.number().int().min(0).max(10080),
  daysAhead: z.number().int().min(1).max(90),
  reminderMinutes: z.number().int().min(0).max(10080),
  reminderTemplateId: z.string().uuid().nullable(),
});
const bookBody = z.object({ contactId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }), notes: z.string().trim().max(1000).nullable().default(null) });
const patchBody = z.object({ status: z.enum(['booked', 'cancelled', 'completed', 'no_show']).optional(), notes: z.string().trim().max(1000).nullable().optional() });
const rangeQuery = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() });

export const appointmentRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const tenant = (req: { principal?: { tenantId: string } }) => req.principal!.tenantId;

  app.get('/settings/booking', async (req) => withTenant(deps.db, tenant(req), async (tx) => {
    const s = await loadSettings(tx);
    return { timezone: s.timezone, hours: s.hours, slotMinutes: s.slot_minutes, capacity: s.capacity, minNoticeMinutes: s.min_notice_minutes,
      daysAhead: s.days_ahead, reminderMinutes: s.reminder_minutes, reminderTemplateId: s.reminder_template_id };
  }));

  app.put('/settings/booking', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const b = settingsBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const s = b.data;
    await withTenant(deps.db, tenant(req), (tx) => tx.query(
      `INSERT INTO booking_settings (tenant_id, timezone, hours, slot_minutes, capacity, min_notice_minutes, days_ahead, reminder_minutes, reminder_template_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET timezone = $2, hours = $3, slot_minutes = $4, capacity = $5, min_notice_minutes = $6,
         days_ahead = $7, reminder_minutes = $8, reminder_template_id = $9`,
      [tenant(req), s.timezone, JSON.stringify(s.hours), s.slotMinutes, s.capacity, s.minNoticeMinutes, s.daysAhead, s.reminderMinutes, s.reminderTemplateId]));
    return { ok: true };
  });

  // Free slots from `from` (default now) to `to` (default the booking horizon).
  app.get('/appointments/slots', async (req, reply) => {
    const q = rangeQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const now = new Date();
    return withTenant(deps.db, tenant(req), async (tx) => {
      const s = await loadSettings(tx);
      const from = q.data.from ? new Date(q.data.from) : now;
      const to = q.data.to ? new Date(q.data.to) : new Date(now.getTime() + s.days_ahead * 86400000);
      const slots = await listFreeSlots(tx, now, from, to, 200);
      return { timezone: s.timezone, slotMinutes: s.slot_minutes, data: slots.map((d) => ({ startsAt: d.toISOString(), label: formatWhen(d, s.timezone) })) };
    });
  });

  app.get('/appointments', async (req, reply) => {
    const q = rangeQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const from = q.data.from ? new Date(q.data.from) : new Date(Date.now() - 86400000);
    const to = q.data.to ? new Date(q.data.to) : new Date(Date.now() + 31 * 86400000);
    return withTenant(deps.db, tenant(req), async (tx) => ({ data: (await tx.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes, a.source, a.reminder_sent_at, c.id AS contact_id, c.name AS contact_name, c.phone_e164 AS contact_phone
         FROM appointments a JOIN contacts c ON c.id = a.contact_id
        WHERE a.starts_at >= $1 AND a.starts_at < $2 ORDER BY a.starts_at LIMIT 500`, [from, to])).rows }));
  });

  app.post('/appointments', async (req, reply) => {
    const b = bookBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const p = req.principal!;
    try {
      const row = await withTenant(deps.db, p.tenantId, async (tx) => {
        const c = await tx.query('SELECT 1 FROM contacts WHERE id = $1', [b.data.contactId]);
        if (!c.rowCount) return null;
        return bookSlot(tx, p.tenantId, { contactId: b.data.contactId, startsAt: new Date(b.data.startsAt), source: req.headers['x-api-key'] ? 'api' : 'agent',
          createdBy: p.userId ?? null, notes: b.data.notes });
      });
      if (!row) return reply.code(404).send({ error: 'contact_not_found' });
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof BookingError) return reply.code(409).send({ error: 'slot_unavailable' });
      throw err;
    }
  });

  app.patch('/appointments/:id', async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const b = patchBody.safeParse(req.body);
    if (!id.success || !b.success) return reply.code(400).send({ error: 'invalid_body' });
    const r = await withTenant(deps.db, tenant(req), (tx) => tx.query(
      `UPDATE appointments SET status = COALESCE($2, status), notes = CASE WHEN $3::boolean THEN $4 ELSE notes END
        WHERE id = $1 RETURNING id, status, notes`, [id.data, b.data.status ?? null, b.data.notes !== undefined, b.data.notes ?? null]));
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });
};
