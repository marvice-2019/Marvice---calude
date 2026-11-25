import type { Deps } from './app.js';
import { decryptSecret } from './crypto.js';
import { withTenant, type Tx } from './db.js';
import { enqueue, PermanentJobError, type Handler } from './jobs.js';
import { sendTemplate, sendText } from './meta.js';

export const REMINDER_QUEUE = 'appointment.remind';
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface BookingSettings {
  timezone: string; hours: Partial<Record<string, [string, string][]>>; slot_minutes: number; capacity: number;
  min_notice_minutes: number; days_ahead: number; reminder_minutes: number; reminder_template_id: string | null;
}
export const DEFAULT_BOOKING: BookingSettings = {
  timezone: 'Asia/Kolkata', hours: {}, slot_minutes: 30, capacity: 1, min_notice_minutes: 60, days_ahead: 14,
  reminder_minutes: 120, reminder_template_id: null,
};
export class BookingError extends Error {}

// ---------- time zones without a library ----------

/** Minutes the zone is ahead of UTC at that instant (330 for India). */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return Math.round((asUtc - at.getTime()) / 60000);
}
/** Wall-clock date + time in the zone → the real instant. Re-checks the offset so DST edges land correctly. */
export function zonedTime(date: string, hm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  t = guess - offsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}
const localDate = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function formatWhen(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(at);
}

// ---------- slots ----------

/** Free slot start times between `from` and `to`, honouring hours, notice, horizon and capacity. */
export function freeSlots(s: BookingSettings, booked: { starts_at: Date; ends_at: Date }[], now: Date, from: Date, to: Date): Date[] {
  const earliest = Math.max(from.getTime(), now.getTime() + s.min_notice_minutes * 60000);
  const latest = Math.min(to.getTime(), now.getTime() + s.days_ahead * 86400000);
  const out: Date[] = [];
  const first = localDate(new Date(earliest), s.timezone);
  for (let i = 0; i <= s.days_ahead + 1; i++) {
    const date = addDays(first, i);
    if (zonedTime(date, '00:00', s.timezone).getTime() > latest) break;
    const day = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
    for (const [open, close] of s.hours[day] ?? []) {
      const end = zonedTime(date, close, s.timezone).getTime();
      for (let t = zonedTime(date, open, s.timezone).getTime(); t + s.slot_minutes * 60000 <= end; t += s.slot_minutes * 60000) {
        if (t < earliest || t > latest) continue;
        const slotEnd = t + s.slot_minutes * 60000;
        const taken = booked.filter((b) => b.starts_at.getTime() < slotEnd && b.ends_at.getTime() > t).length;
        if (taken < s.capacity) out.push(new Date(t));
      }
    }
  }
  return out;
}

export async function loadSettings(tx: Tx): Promise<BookingSettings> {
  const r = await tx.query<BookingSettings>(
    `SELECT timezone, hours, slot_minutes, capacity, min_notice_minutes, days_ahead, reminder_minutes, reminder_template_id
       FROM booking_settings`);
  return r.rows[0] ?? DEFAULT_BOOKING;
}

export async function listFreeSlots(tx: Tx, now: Date, from: Date, to: Date, limit = 50): Promise<Date[]> {
  const s = await loadSettings(tx);
  const booked = (await tx.query<{ starts_at: Date; ends_at: Date }>(
    "SELECT starts_at, ends_at FROM appointments WHERE status = 'booked' AND starts_at < $2 AND ends_at > $1",
    [from, new Date(to.getTime() + s.slot_minutes * 60000)])).rows;
  return freeSlots(s, booked, now, from, to).slice(0, limit);
}

/** Books one slot. Serialised per workspace so two customers cannot take the last place in a slot at once. */
export async function bookSlot(tx: Tx, tenantId: string, a: { contactId: string; startsAt: Date; source: 'agent' | 'flow' | 'api';
  createdBy?: string | null; notes?: string | null }, now = new Date()) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1 || ':booking'))", [tenantId]);
  const s = await loadSettings(tx);
  const free = await listFreeSlots(tx, now, a.startsAt, a.startsAt, 1);
  if (free[0]?.getTime() !== a.startsAt.getTime()) throw new BookingError('slot_unavailable');
  const endsAt = new Date(a.startsAt.getTime() + s.slot_minutes * 60000);
  const row = (await tx.query<{ id: string; starts_at: Date; ends_at: Date }>(
    `INSERT INTO appointments (tenant_id, contact_id, starts_at, ends_at, source, created_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, starts_at, ends_at`,
    [tenantId, a.contactId, a.startsAt, endsAt, a.source, a.createdBy ?? null, a.notes ?? null])).rows[0]!;
  await scheduleReminder(tx, tenantId, row.id, a.startsAt, s.reminder_minutes, now);
  return { ...row, when: formatWhen(a.startsAt, s.timezone) };
}

export async function scheduleReminder(tx: Tx, tenantId: string, appointmentId: string, startsAt: Date, minutesBefore: number, now = new Date()) {
  if (!minutesBefore) return;
  const runAt = new Date(startsAt.getTime() - minutesBefore * 60000);
  if (runAt <= now) return;
  await enqueue(tx, REMINDER_QUEUE, { appointmentId, startsAt: startsAt.toISOString() },
    { tenantId, runAt, dedupeKey: `remind:${appointmentId}:${startsAt.toISOString()}` });
}

/** Sends the reminder: the chosen template ({{1}} = name, {{2}} = date and time), or plain text while the 24-hour window is open. */
export function reminderHandler(deps: Deps): Handler {
  return async (job) => {
    const tenantId = job.tenant_id;
    const { appointmentId, startsAt } = job.payload as { appointmentId?: string; startsAt?: string };
    if (!tenantId || !appointmentId || !startsAt) throw new PermanentJobError('bad payload');
    const plan = await withTenant(deps.db, tenantId, async (tx) => {
      const a = (await tx.query<{ status: string; starts_at: Date; reminder_sent_at: Date | null; contact_id: string; name: string | null; phone: string }>(
        `SELECT a.status, a.starts_at, a.reminder_sent_at, a.contact_id, c.name, c.phone_e164 AS phone
           FROM appointments a JOIN contacts c ON c.id = a.contact_id WHERE a.id = $1`, [appointmentId])).rows[0];
      // Cancelled, already reminded, or moved to another time (that time has its own job).
      if (!a || a.status !== 'booked' || a.reminder_sent_at || a.starts_at.toISOString() !== startsAt) return null;
      const s = await loadSettings(tx);
      const conv = (await tx.query<{ id: string; last_inbound_at: Date | null; meta_pn: string; token: string }>(
        `SELECT cv.id, cv.last_inbound_at, pn.meta_phone_number_id AS meta_pn, w.access_token_enc AS token
           FROM conversations cv JOIN phone_numbers pn ON pn.id = cv.phone_number_id JOIN waba_accounts w ON w.id = pn.waba_account_id
          WHERE cv.contact_id = $1 ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1`, [a.contact_id])).rows[0];
      if (!conv) return null;
      const tpl = s.reminder_template_id ? (await tx.query<{ name: string; language: string; components: { type: string; text?: string }[] }>(
        "SELECT name, language, components FROM message_templates WHERE id = $1 AND status = 'APPROVED'", [s.reminder_template_id])).rows[0] : undefined;
      return { a, s, conv, tpl };
    });
    if (!plan) return;
    const { a, s, conv, tpl } = plan;
    const when = formatWhen(a.starts_at, s.timezone);
    const token = decryptSecret(conv.token, deps.config.TOKEN_ENCRYPTION_KEY);
    const ver = deps.config.META_GRAPH_VERSION;
    let wamid: string, body: string;
    if (tpl) {
      const text = tpl.components.find((c) => c.type.toUpperCase() === 'BODY')?.text ?? '';
      const count = new Set(text.match(/\{\{\d+\}\}/g) ?? []).size;
      const params = [a.name ?? 'there', when].slice(0, count);
      body = `[template ${tpl.name}] ${params.join(' · ')}`;
      wamid = await sendTemplate(deps.fetch, ver, conv.meta_pn, token, a.phone, { name: tpl.name, language: tpl.language,
        components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] : [] });
    } else if (conv.last_inbound_at && Date.now() - conv.last_inbound_at.getTime() < SERVICE_WINDOW_MS) {
      body = `Reminder: your appointment is on ${when}. Reply here if you need to change it.`;
      wamid = await sendText(deps.fetch, ver, conv.meta_pn, token, a.phone, body);
    } else {
      // Outside the 24-hour window WhatsApp only allows templates; nothing can be sent.
      return;
    }
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx.query('UPDATE appointments SET reminder_sent_at = now() WHERE id = $1', [appointmentId]);
      await tx.query(`INSERT INTO messages (tenant_id, conversation_id, direction, type, body, wa_message_id, status)
                      VALUES ($1, $2, 'outbound', $3, $4, $5, 'sent')`, [tenantId, conv.id, tpl ? 'template' : 'text', body, wamid]);
    });
  };
}
