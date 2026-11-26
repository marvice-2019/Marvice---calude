import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Deps } from './app.js';
import { isSafeWebhookUrl } from './automation.js';
import { decryptSecret } from './crypto.js';
import { withTenant, type Tx } from './db.js';
import { enqueue, PermanentJobError, type Handler } from './jobs.js';

export const IMPORT_QUEUE = 'contacts.import';
export const WEBHOOK_QUEUE = 'webhook.deliver';
export const EVENTS = ['message.received', 'message.status', 'contact.created', 'campaign.completed', 'order.created'] as const;
export type EventName = (typeof EVENTS)[number];

// ---------- CSV ----------

/** RFC 4180 CSV: quoted fields, escaped quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;   // strip a BOM (Excel exports)
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Digits-only international number, or null. A 10-digit local number gets the default country code. */
export function normalisePhone(raw: string, defaultCc: string): string | null {
  let d = raw.replace(/[^\d+]/g, '');
  const hadPlus = d.startsWith('+');
  d = d.replace(/\+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (!hadPlus && d.length === 11 && d.startsWith('0')) d = defaultCc + d.slice(1);   // 0-prefixed local
  else if (!hadPlus && d.length === 10) d = defaultCc + d;
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

/** Job: imports a queued CSV. Columns by header: phone (required), name, email, tags (separated by ; or |). */
export function importHandler(deps: Deps): Handler {
  return async (job) => {
    const tenantId = job.tenant_id, jobId = job.payload.importId;
    if (!tenantId || typeof jobId !== 'string') throw new PermanentJobError('bad payload');
    const imp = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<{ csv: string | null; default_cc: string; opt_in_source: string | null }>(
      "UPDATE import_jobs SET status = 'running' WHERE id = $1 AND status IN ('queued','running') RETURNING csv, default_cc, opt_in_source", [jobId])).rows[0]);
    if (!imp?.csv) return;

    const rows = parseCsv(imp.csv);
    const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
    const col = (names: string[]) => header.findIndex((h) => names.includes(h));
    const iPhone = col(['phone', 'mobile', 'number', 'whatsapp', 'phone number']), iName = col(['name', 'full name']),
      iEmail = col(['email', 'e-mail']), iTags = col(['tags', 'tag']);
    const errors: { row: number; reason: string }[] = [];
    let created = 0, updated = 0;
    if (iPhone < 0) errors.push({ row: 1, reason: 'no phone column (expected a header named phone, mobile or number)' });

    await withTenant(deps.db, tenantId, async (tx) => {
      if (iPhone < 0) return;
      const lim = (await tx.query<{ max_value: number; used: string }>("SELECT max_value, used FROM tenant_limit_usage('contacts')")).rows[0];
      let room = lim ? lim.max_value - Number(lim.used) : Number.POSITIVE_INFINITY;
      const tagIds = new Map<string, string>();
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!, line = r + 2;
        const phone = normalisePhone(row[iPhone] ?? '', imp.default_cc);
        if (!phone) { errors.push({ row: line, reason: 'invalid phone number' }); continue; }
        const name = iName >= 0 ? (row[iName] ?? '').trim().slice(0, 120) || null : null;
        const emailRaw = iEmail >= 0 ? (row[iEmail] ?? '').trim().toLowerCase() : '';
        const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
        const exists = (await tx.query<{ id: string }>('SELECT id FROM contacts WHERE phone_e164 = $1', [phone])).rows[0];
        if (!exists && room <= 0) { errors.push({ row: line, reason: 'plan contact limit reached' }); continue; }
        const up = await tx.query<{ id: string; inserted: boolean }>(
          `INSERT INTO contacts (tenant_id, phone_e164, name, email, opted_in_at, opt_in_source)
           VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $5)
           ON CONFLICT (tenant_id, phone_e164) DO UPDATE SET name = coalesce(EXCLUDED.name, contacts.name), email = coalesce(EXCLUDED.email, contacts.email)
           RETURNING id, (xmax = 0) AS inserted`, [tenantId, phone, name, email, imp.opt_in_source]);
        const c = up.rows[0]!;
        if (c.inserted) { created++; room--; } else updated++;
        const labels = iTags >= 0 ? (row[iTags] ?? '').split(/[;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 10) : [];
        for (const label of labels) {
          const key = label.toLowerCase().slice(0, 40);
          let tagId = tagIds.get(key);
          if (!tagId) {
            tagId = (await tx.query<{ id: string }>(
              `INSERT INTO tags (tenant_id, label) VALUES ($1, $2)
               ON CONFLICT (tenant_id, lower(label)) DO UPDATE SET label = tags.label RETURNING id`, [tenantId, label.slice(0, 40)])).rows[0]!.id;
            tagIds.set(key, tagId);
          }
          await tx.query('INSERT INTO contact_tags (tenant_id, contact_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, c.id, tagId]);
        }
      }
    });

    await withTenant(deps.db, tenantId, (tx) => tx.query(
      `UPDATE import_jobs SET status = 'done', csv = NULL, total = $2, created_count = $3, updated_count = $4,
              error_count = $5, errors = $6 WHERE id = $1`,
      [jobId, rows.length, created, updated, errors.length, JSON.stringify(errors.slice(0, 50))]));
  };
}

// ---------- API keys ----------

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `wak_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

// ---------- outbound webhooks ----------

/** Queues one delivery per active endpoint subscribed to `event`. Call inside the tenant transaction. */
export async function queueEvent(tx: Tx, tenantId: string, event: EventName, data: unknown): Promise<void> {
  const eps = await tx.query<{ id: string }>('SELECT id FROM webhook_endpoints WHERE is_active AND $1 = ANY(events)', [event]);
  if (!eps.rowCount) return;
  const envelope = { id: randomUUID(), event, created_at: new Date().toISOString(), data };
  for (const ep of eps.rows) {
    await enqueue(tx, WEBHOOK_QUEUE, { endpointId: ep.id, envelope }, { tenantId, maxAttempts: 6 });
  }
}

export const signBody = (secret: string, body: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

/** Job: POSTs one event. Non-2xx or network error → retried with backoff (up to 6 tries). */
export function webhookDeliverHandler(deps: Deps): Handler {
  return async (job) => {
    const tenantId = job.tenant_id;
    const { endpointId, envelope } = job.payload as { endpointId?: string; envelope?: { event: string } };
    if (!tenantId || !endpointId || !envelope) throw new PermanentJobError('bad payload');
    const ep = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<{ url: string; secret_enc: string; is_active: boolean }>(
      'SELECT url, secret_enc, is_active FROM webhook_endpoints WHERE id = $1', [endpointId])).rows[0]);
    if (!ep?.is_active) return;
    if (!isSafeWebhookUrl(ep.url)) throw new PermanentJobError('endpoint url not allowed');
    const body = JSON.stringify(envelope);
    let status = 0, error: string | null = null;
    try {
      const res = await deps.fetch(ep.url, { method: 'POST', body, headers: {
        'content-type': 'application/json', 'x-wacrm-event': envelope.event,
        'x-wacrm-signature': signBody(decryptSecret(ep.secret_enc, deps.config.TOKEN_ENCRYPTION_KEY), body) } });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = (err as Error).message.slice(0, 300);
    }
    await withTenant(deps.db, tenantId, (tx) => tx.query(
      'UPDATE webhook_endpoints SET last_status = $2, last_error = $3, last_sent_at = now() WHERE id = $1', [endpointId, status || null, error]));
    if (error) throw new Error(`webhook delivery failed: ${error}`);
  };
}
