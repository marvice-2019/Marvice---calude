import type pg from "pg";
import type { NotificationKind } from "../data/notifications";
import type { InviteeAnswer, LocationKind } from "../data/types";
import type { HourCycle } from "../format";
import { MailError, type Mailer } from "../mail/mailer";
import { renderBookingMail, type BookingMailContext } from "../mail/templates";

// Sends due notifications. Several workers can run at once: each claims rows with FOR UPDATE SKIP LOCKED and a lease
// (locked_until), so a row is never sent by two workers, and a worker that dies mid-send frees its rows when the lease
// ends. The notification id is Resend's idempotency key, so a retry after a crash between "sent" and "recorded" is
// dropped by Resend instead of reaching the guest twice.

export const MAX_ATTEMPTS = 5;
/** Wait before attempt 2, 3, 4, 5. */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
const LEASE_MINUTES = 5;
/** Rows claimed per run. Each send is renewed before it starts, so a slow batch can't outlive its lease. */
export const BATCH_SIZE = 10;
const MIN = 60_000;

export interface WorkerResult { claimed: number; sent: number; skipped: number; retrying: number; failed: number }

interface Claimed { id: string; booking_id: string; kind: NotificationKind; recipient: string; attempts: number; locked_until: Date }

/** Claims up to `limit` due rows. Each claim counts as an attempt, so a row that keeps crashing its worker still runs out. */
export async function claimDue(pool: pg.Pool, now: Date, limit: number): Promise<Claimed[]> {
  const { rows } = await pool.query(
    `update notifications n set locked_until = $1::timestamptz + make_interval(mins => $3), attempts = n.attempts + 1, updated_at = $1
     from (select id from notifications
           where status = 'queued' and channel = 'email' and send_at <= $1 and (locked_until is null or locked_until < $1)
           order by send_at limit $2 for update skip locked) due
     where n.id = due.id
     returning n.id, n.booking_id, n.kind, n.recipient, n.attempts, n.locked_until`, [now, limit, LEASE_MINUTES]);
  return rows as Claimed[];
}

const CONTEXT = `
  select n.id as notification_id, n.created_at as queued_at, b.id, b.status, b.start_at, b.end_at, b.cancelled_by, b.cancel_reason,
    prev.start_at as previous_start_at,
    i.name as guest_name, i.email as guest_email, i.timezone as guest_timezone, i.answers, i.manage_token, i.reminders_opt_out,
    e.name as event_name,
    coalesce(u.name, '') as host_name, u.email as host_email, u.timezone as host_timezone, u.time_format as host_time_format,
    loc.kind as location_kind, loc.value as location_value
  from notifications n
  join bookings b on b.id = n.booking_id
  join invitees i on i.booking_id = b.id
  join event_types e on e.id = b.event_type_id
  join users u on u.id = b.host_id
  left join bookings prev on prev.id = b.rescheduled_from_id
  left join lateral (select kind, value from event_locations l where l.event_type_id = e.id order by position limit 1) loc on true
  where n.id = any($1::uuid[])`;

type ContextRow = Record<string, unknown>;

function toContext(r: ContextRow, baseUrl: string): BookingMailContext {
  return {
    bookingId: r.id as string, eventName: r.event_name as string,
    hostName: r.host_name as string, hostEmail: r.host_email as string, hostTimezone: r.host_timezone as string, hostTimeFormat: r.host_time_format as HourCycle,
    guestName: r.guest_name as string, guestEmail: r.guest_email as string, guestTimezone: r.guest_timezone as string,
    startAt: new Date(r.start_at as Date), endAt: new Date(r.end_at as Date),
    location: r.location_kind ? { kind: r.location_kind as LocationKind, value: (r.location_value as string | null) ?? null } : null,
    answers: (r.answers as InviteeAnswer[]) ?? [],
    cancelledBy: (r.cancelled_by as BookingMailContext["cancelledBy"]) ?? null, cancelReason: (r.cancel_reason as string | null) ?? null,
    previousStartAt: r.previous_start_at ? new Date(r.previous_start_at as Date) : null,
    issuedAt: new Date(r.queued_at as Date),
    manageUrl: `${baseUrl}/b/${r.manage_token as string}`, dashboardUrl: `${baseUrl}/dashboard/bookings/${r.id as string}`,
  };
}

/** Why a claimed row should not be sent any more, or null to send it. */
export function skipReason(kind: NotificationKind, r: ContextRow, now: Date): string | null {
  const start = new Date(r.start_at as Date);
  const cancellation = kind === "cancelled_guest" || kind === "cancelled_host";
  // A confirmation, reminder or "moved" email for a booking that has since been cancelled or moved would be wrong news.
  if (!cancellation && r.status !== "confirmed") return "booking cancelled";
  if (kind === "reminder_guest") {
    if (r.reminders_opt_out) return "guest opted out of reminders";
    if (start <= now) return "booking already started";
    return null;
  }
  // Everything else is news about a booking; once the meeting is over it is no longer worth sending.
  if (new Date(r.end_at as Date) <= now) return "booking already over";
  return null;
}

export async function processDueNotifications(pool: pg.Pool, mailer: Mailer, opts: { baseUrl: string; now?: Date; limit?: number }): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const claimed = await claimDue(pool, now, opts.limit ?? BATCH_SIZE);
  const result: WorkerResult = { claimed: claimed.length, sent: 0, skipped: 0, retrying: 0, failed: 0 };
  if (claimed.length === 0) return result;

  const { rows } = await pool.query(CONTEXT, [claimed.map((c) => c.id)]);
  const contexts = new Map(rows.map((r) => [r.notification_id as string, r as ContextRow]));

  // Every write checks the lease, so a worker whose lease ran out can't overwrite the next worker's result.
  const finish = (c: Claimed, status: "sent" | "skipped" | "failed", fields: { providerId?: string; error?: string }) =>
    pool.query(
      `update notifications set status = $3, provider_message_id = coalesce($4, provider_message_id), last_error = $5,
         sent_at = case when $3 = 'sent' then $6::timestamptz else sent_at end, locked_until = null, updated_at = $6
       where id = $1 and locked_until = $2`,
      [c.id, c.locked_until, status, fields.providerId ?? null, fields.error ?? null, now]);

  for (const c of claimed) {
    const r = contexts.get(c.id);
    if (!r) {
      await finish(c, "skipped", { error: "booking no longer exists" });
      result.skipped++;
      continue;
    }
    if (c.attempts > MAX_ATTEMPTS) {
      await finish(c, "failed", { error: `gave up after ${MAX_ATTEMPTS} attempts (the worker stopped during the last one)` });
      result.failed++;
      continue;
    }
    const skip = skipReason(c.kind, r, now);
    if (skip) {
      await finish(c, "skipped", { error: skip });
      result.skipped++;
      continue;
    }
    // Renew the lease for this row only, right before sending. If another worker took the row over, leave it to them.
    const renewed = await pool.query(
      "update notifications set locked_until = $3 where id = $1 and locked_until = $2 returning locked_until",
      [c.id, c.locked_until, new Date(Math.max(now.getTime(), Date.now()) + LEASE_MINUTES * MIN)]);
    if (!renewed.rowCount) continue;
    c.locked_until = renewed.rows[0].locked_until as Date;

    let providerId: string;
    try {
      const mail = renderBookingMail(c.kind, toContext(r, opts.baseUrl));
      ({ id: providerId } = await mailer.send({ ...mail, to: c.recipient, idempotencyKey: `notification-${c.id}` }));
    } catch (error) {
      const retryable = error instanceof MailError ? error.retryable : true;
      const message = (error as Error).message.slice(0, 500);
      if (!retryable || c.attempts >= MAX_ATTEMPTS) {
        await finish(c, "failed", { error: message });
        result.failed++;
        console.error(`[jobs] notification ${c.id} (${c.kind}) failed for good: ${message}`);
      } else {
        const delay = RETRY_DELAYS_MINUTES[Math.min(c.attempts, RETRY_DELAYS_MINUTES.length) - 1];
        await pool.query(
          "update notifications set send_at = $3, last_error = $4, locked_until = null, updated_at = $5 where id = $1 and locked_until = $2",
          [c.id, c.locked_until, new Date(now.getTime() + delay * MIN), message, now]);
        result.retrying++;
        console.warn(`[jobs] notification ${c.id} (${c.kind}) attempt ${c.attempts} failed, retrying in ${delay} min: ${message}`);
      }
      continue;
    }
    // Recorded outside the send's try: a database error here must not be mistaken for a failed send and retried.
    await finish(c, "sent", { providerId });
    result.sent++;
  }
  return result;
}
