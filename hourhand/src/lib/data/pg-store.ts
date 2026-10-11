import pg from "pg";
import { datesInRange } from "../availability";
import { kickJobs } from "../jobs/kick";
import { closeAccount, purgeClosedAccounts } from "./account-lifecycle";
import { queueBookingNotifications } from "./notifications";
import {
  EventTypeInUseError, NotFoundError, RequestKeyConflictError, SlotTakenError, SlugTakenError, type AvailabilityRule, type BookingWithInvitee, type CreateBookingInput, type DataStore,
  type EventType, type EventTypeDraft, type Interval, type User,
} from "./types";

const MIN = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids come from URLs and forms; anything that is not a uuid cannot match a row (and would make Postgres raise 22P02). */
const isId = (id: string) => UUID.test(id);

type Row = Record<string, unknown>;
type Db = Pick<pg.Pool | pg.PoolClient, "query">;

const shared = globalThis as typeof globalThis & { __hourhandPool?: pg.Pool };

/** One pool per process, shared by every bundle that imports this module. */
export function getPool(databaseUrl: string): pg.Pool {
  return (shared.__hourhandPool ??= new pg.Pool({ connectionString: databaseUrl }));
}

const USER = "id, email, coalesce(name, '') as name, slug, timezone, time_format";
const toUser = (r: Row): User => ({ id: r.id as string, email: r.email as string, name: r.name as string, slug: r.slug as string, timezone: r.timezone as string, timeFormat: r.time_format as User["timeFormat"] });

const EVENT = `id, user_id, schedule_id, name, slug, description, duration_minutes, min_notice_minutes, booking_window_days, start_increment_minutes,
  buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, price_minor, currency, hidden, active, position`;
const toEventType = (r: Row): EventType => ({
  id: r.id as string, userId: r.user_id as string, scheduleId: r.schedule_id as string | null, name: r.name as string, slug: r.slug as string,
  description: r.description as string | null, durationMinutes: r.duration_minutes as number, minNoticeMinutes: r.min_notice_minutes as number,
  bookingWindowDays: r.booking_window_days as number, startIncrementMinutes: r.start_increment_minutes as number, bufferBeforeMinutes: r.buffer_before_minutes as number,
  bufferAfterMinutes: r.buffer_after_minutes as number, dailyLimit: r.daily_limit as number | null, cancelCutoffMinutes: r.cancel_cutoff_minutes as number,
  priceMinor: r.price_minor as number | null, currency: r.currency as EventType["currency"], hidden: r.hidden as boolean, active: r.active as boolean, position: r.position as number,
});

const BOOKING = `select b.id, b.event_type_id, b.host_id, b.start_at, b.end_at, b.buffered_start, b.buffered_end, b.status, b.hold_expires_at, b.location_kind, b.join_url, b.idempotency_key,
  b.cancelled_at, b.cancelled_by, b.cancel_reason, b.rescheduled_from_id, b.created_at,
  i.id as invitee_id, i.name as invitee_name, i.email as invitee_email, i.timezone as invitee_timezone, i.phone as invitee_phone, i.answers, i.manage_token
  from bookings b join invitees i on i.booking_id = b.id`;
const toBooking = (r: Row): BookingWithInvitee => ({
  id: r.id as string, eventTypeId: r.event_type_id as string, hostId: r.host_id as string, startAt: r.start_at as Date, endAt: r.end_at as Date,
  bufferedStart: r.buffered_start as Date, bufferedEnd: r.buffered_end as Date, status: r.status as BookingWithInvitee["status"],
  holdExpiresAt: (r.hold_expires_at as Date | null) ?? null,
  locationKind: r.location_kind as BookingWithInvitee["locationKind"], joinUrl: (r.join_url as string | null) ?? null, idempotencyKey: r.idempotency_key as string, cancelledAt: r.cancelled_at as Date | null,
  cancelledBy: r.cancelled_by as BookingWithInvitee["cancelledBy"], cancelReason: r.cancel_reason as string | null, rescheduledFromId: r.rescheduled_from_id as string | null,
  createdAt: r.created_at as Date,
  invitee: {
    id: r.invitee_id as string, bookingId: r.id as string, hostId: r.host_id as string, name: r.invitee_name as string, email: r.invitee_email as string,
    timezone: r.invitee_timezone as string, phone: r.invitee_phone as string | null, answers: r.answers as BookingWithInvitee["invitee"]["answers"], manageToken: r.manage_token as string,
  },
});

const code = (error: unknown) => (error as { code?: string }).code;

/** Postgres implementation of DataStore. Every read or write of host data filters by the user id it is given. */
export function createPgStore(pool: pg.Pool): DataStore {
  async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function bookingWhere(db: Db, where: string, values: unknown[]): Promise<BookingWithInvitee | null> {
    const { rows } = await db.query(`${BOOKING} where ${where}`, values);
    return rows[0] ? toBooking(rows[0]) : null;
  }

  const byKey = (db: Db, key: string) => bookingWhere(db, "b.idempotency_key = $1", [key]);

  /**
   * Inserts a booking (confirmed, or pending_payment with a hold) and its invitee. The no_double_booking constraint is the
   * overlap guard (23P01); it covers holds too, so this host's lapsed holds are cancelled first and never block the insert.
   */
  async function insertBooking(client: pg.PoolClient, input: CreateBookingInput, movingId: string | null): Promise<string> {
    if (!isId(input.eventTypeId)) throw new Error(`Unknown event type ${input.eventTypeId}`);
    await expireHolds(client, input.eventTypeId);
    const { rows } = await client.query(
      `select e.user_id, e.duration_minutes, e.buffer_before_minutes, e.buffer_after_minutes,
         (select kind from event_locations l where l.event_type_id = e.id order by position limit 1) as location_kind
       from event_types e where e.id = $1`, [input.eventTypeId]);
    const et = rows[0];
    if (!et) throw new Error(`Unknown event type ${input.eventTypeId}`);
    const startAt = input.startAt;
    const endAt = new Date(startAt.getTime() + et.duration_minutes * MIN);
    const inserted = await client.query(
      `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, location_kind, idempotency_key, rescheduled_from_id, hold_expires_at)
       values ($1,$2,$3,$4,$5,$6,$10,$7,$8,$9,$11) returning id`,
      [input.eventTypeId, et.user_id, startAt, endAt, new Date(startAt.getTime() - et.buffer_before_minutes * MIN), new Date(endAt.getTime() + et.buffer_after_minutes * MIN),
        et.location_kind, input.idempotencyKey, movingId, input.holdUntil ? "pending_payment" : "confirmed", input.holdUntil ?? null]);
    const id = inserted.rows[0].id as string;
    const i = input.invitee;
    await client.query("insert into invitees (booking_id, host_id, name, email, timezone, phone, answers) values ($1,$2,$3,$4,$5,$6,$7)",
      [id, et.user_id, i.name, i.email, i.timezone, i.phone, JSON.stringify(i.answers)]);
    return id;
  }

  /** Cancels the event type's host's lapsed payment holds (and fails their payments), freeing those slots. */
  async function expireHolds(client: pg.PoolClient, eventTypeId: string): Promise<void> {
    const { rows } = await client.query(
      `update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancel_reason = 'Payment not completed', hold_expires_at = null
       where host_id = (select user_id from event_types where id = $1) and status = 'pending_payment' and hold_expires_at < now() returning id`, [eventTypeId]);
    if (rows.length > 0) {
      await client.query("update payments set status = 'failed', updated_at = now() where booking_id = any($1::uuid[]) and status = 'pending'", [rows.map((r) => r.id)]);
    }
  }

  /** A key already used for this same request returns its booking; a key used for anything else is a conflict. */
  function sameRequestOrConflict(existing: BookingWithInvitee, isSameRequest: (b: BookingWithInvitee) => boolean): BookingWithInvitee {
    if (isSameRequest(existing)) return existing;
    throw new RequestKeyConflictError();
  }

  /** A lost race on the idempotency key returns the winner's booking (if it is the same request); a lost race on the slot is SlotTakenError. */
  async function settle(error: unknown, idempotencyKey: string, isSameRequest: (b: BookingWithInvitee) => boolean): Promise<BookingWithInvitee> {
    if (code(error) === "23505" || code(error) === "23P01") {
      const winner = await byKey(pool, idempotencyKey);
      if (winner) return sameRequestOrConflict(winner, isSameRequest);
      if (code(error) === "23P01") throw new SlotTakenError();
    }
    throw error;
  }

  async function owned(db: Db, userId: string, id: string): Promise<EventType> {
    const { rows } = isId(userId) && isId(id) ? await db.query(`select ${EVENT} from event_types where user_id = $1 and id = $2`, [userId, id]) : { rows: [] };
    if (!rows[0]) throw new NotFoundError("Event type");
    return toEventType(rows[0]);
  }

  async function ownedSchedule(db: Db, userId: string, scheduleId: string) {
    const { rowCount } = isId(userId) && isId(scheduleId)
      ? await db.query("select 1 from availability_schedules where id = $1 and user_id = $2", [scheduleId, userId]) : { rowCount: 0 };
    if (!rowCount) throw new NotFoundError("Schedule");
  }

  async function setLocation(client: pg.PoolClient, eventTypeId: string, draft: EventTypeDraft) {
    await client.query("delete from event_locations where event_type_id = $1", [eventTypeId]);
    if (draft.location) await client.query("insert into event_locations (event_type_id, kind, value, position) values ($1,$2,$3,0)", [eventTypeId, draft.location.kind, draft.location.value]);
  }

  const draftValues = (d: EventTypeDraft) => [d.name, d.slug, d.description, d.durationMinutes, d.minNoticeMinutes, d.bookingWindowDays, d.startIncrementMinutes,
    d.bufferBeforeMinutes, d.bufferAfterMinutes, d.dailyLimit, d.cancelCutoffMinutes, d.priceMinor, d.priceMinor === null ? null : d.currency];

  async function slugSafe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (code(error) === "23505" && (error as { constraint?: string }).constraint === "event_types_user_id_slug_key") throw new SlugTakenError();
      throw error;
    }
  }

  async function setOverride(db: Db, scheduleId: string, date: string, intervals: Interval[]) {
    await db.query("delete from availability_rules where schedule_id = $1 and kind = 'date' and on_date = $2", [scheduleId, date]);
    await db.query("insert into availability_rules (schedule_id, kind, on_date, intervals) values ($1,'date',$2,$3)", [scheduleId, date, JSON.stringify(intervals)]);
  }

  return {
    async getCurrentUser() {
      throw new Error("In Postgres mode the current user comes from the session: use requireUser() from @/lib/auth/session");
    },
    async getUser(id) {
      if (!isId(id)) return null;
      const { rows } = await pool.query(`select ${USER} from users where id = $1 and deleted_at is null`, [id]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async getUserBySlug(slug) {
      const { rows } = await pool.query(`select ${USER} from users where slug = $1 and deleted_at is null`, [slug]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async listEventTypes(userId) {
      if (!isId(userId)) return [];
      return (await pool.query(`select ${EVENT} from event_types where user_id = $1 order by position, created_at`, [userId])).rows.map(toEventType);
    },
    async getEventType(userId, id) {
      if (!isId(userId) || !isId(id)) return null;
      const { rows } = await pool.query(`select ${EVENT} from event_types where user_id = $1 and id = $2`, [userId, id]);
      return rows[0] ? toEventType(rows[0]) : null;
    },
    async getPublicEventType(hostSlug, eventSlug) {
      const host = await this.getUserBySlug(hostSlug);
      if (!host) return null;
      const { rows } = await pool.query(`select ${EVENT} from event_types where user_id = $1 and slug = $2 and active`, [host.id, eventSlug]);
      return rows[0] ? { host, eventType: toEventType(rows[0]) } : null;
    },
    async listEventLocations(userId, eventTypeId) {
      if (!isId(userId) || !isId(eventTypeId)) return [];
      const { rows } = await pool.query(
        "select l.id, l.event_type_id, l.kind, l.value, l.position from event_locations l join event_types e on e.id = l.event_type_id where l.event_type_id = $1 and e.user_id = $2 order by l.position",
        [eventTypeId, userId]);
      return rows.map((r) => ({ id: r.id, eventTypeId: r.event_type_id, kind: r.kind, value: r.value, position: r.position }));
    },
    async listCustomQuestions(userId, eventTypeId) {
      if (!isId(userId) || !isId(eventTypeId)) return [];
      const { rows } = await pool.query(
        "select q.id, q.event_type_id, q.label, q.kind, q.required, q.choices, q.position from custom_questions q join event_types e on e.id = q.event_type_id where q.event_type_id = $1 and e.user_id = $2 order by q.position",
        [eventTypeId, userId]);
      return rows.map((r) => ({ id: r.id, eventTypeId: r.event_type_id, label: r.label, kind: r.kind, required: r.required, choices: r.choices, position: r.position }));
    },
    async getDefaultSchedule(userId) {
      const { rows } = isId(userId) ? await pool.query("select id, user_id, name, timezone, is_default from availability_schedules where user_id = $1 and is_default", [userId]) : { rows: [] };
      if (!rows[0]) throw new Error(`No default schedule for ${userId}`);
      const s = rows[0];
      const rules = await pool.query("select id, schedule_id, kind, weekday, on_date::text as on_date, intervals from availability_rules where schedule_id = $1 order by kind desc, weekday, on_date", [s.id]);
      return {
        schedule: { id: s.id, userId: s.user_id, name: s.name, timezone: s.timezone, isDefault: s.is_default },
        rules: rules.rows.map((r): AvailabilityRule => r.kind === "weekly"
          ? { id: r.id, scheduleId: r.schedule_id, kind: "weekly", weekday: r.weekday, onDate: null, intervals: r.intervals }
          : { id: r.id, scheduleId: r.schedule_id, kind: "date", weekday: null, onDate: r.on_date, intervals: r.intervals }),
      };
    },
    async listCalendarConnections(userId) {
      if (!isId(userId)) return [];
      const { rows } = await pool.query("select id, user_id, provider, account_email, status, last_synced_at, last_error from calendar_connections where user_id = $1 order by created_at", [userId]);
      return rows.map((r) => ({ id: r.id, userId: r.user_id, provider: r.provider, accountEmail: r.account_email, status: r.status, lastSyncedAt: r.last_synced_at, lastError: r.last_error }));
    },
    async listCalendars(userId) {
      if (!isId(userId)) return [];
      const { rows } = await pool.query("select id, connection_id, user_id, name, check_conflicts, is_add_to, access_role from calendars where user_id = $1 order by created_at", [userId]);
      return rows.map((r) => ({ id: r.id, connectionId: r.connection_id, userId: r.user_id, name: r.name, checkConflicts: r.check_conflicts, isAddTo: r.is_add_to, canWrite: r.access_role === "owner" }));
    },
    async listBusyBlocks(userId, from, to) {
      if (!isId(userId)) return [];
      const { rows } = await pool.query(
        "select id, calendar_id, user_id, lower(busy) as start, upper(busy) as end from busy_blocks where user_id = $1 and busy && tstzrange($2, $3, '[)') order by lower(busy)", [userId, from, to]);
      return rows.map((r) => ({ id: r.id, calendarId: r.calendar_id, userId: r.user_id, start: r.start, end: r.end }));
    },
    async listBookings(userId) {
      if (!isId(userId)) return [];
      return (await pool.query(`${BOOKING} where b.host_id = $1 order by b.start_at`, [userId])).rows.map(toBooking);
    },
    async getBooking(userId, id) {
      if (!isId(userId) || !isId(id)) return null;
      return bookingWhere(pool, "b.host_id = $1 and b.id = $2", [userId, id]);
    },
    async getBookingByManageToken(token) {
      return bookingWhere(pool, "i.manage_token = $1", [token]);
    },
    async createBooking(input) {
      const isSameRequest = (b: BookingWithInvitee) => b.eventTypeId === input.eventTypeId && b.rescheduledFromId === null;
      const repeat = await byKey(pool, input.idempotencyKey);
      if (repeat) return sameRequestOrConflict(repeat, isSameRequest);
      try {
        const id = await tx(async (client) => {
          const newId = await insertBooking(client, input, null);
          // A held booking says nothing yet: its emails and calendar write go out once the payment is confirmed.
          if (!input.holdUntil) await queueBookingNotifications(client, newId, "booked", new Date());
          return newId;
        });
        kickJobs();
        return (await bookingWhere(pool, "b.id = $1", [id]))!;
      } catch (error) {
        return settle(error, input.idempotencyKey, isSameRequest);
      }
    },
    async rescheduleBooking(hostId, bookingId, startAt, idempotencyKey) {
      if (!isId(hostId) || !isId(bookingId)) throw new NotFoundError("Booking");
      const isSameRequest = (b: BookingWithInvitee) => b.hostId === hostId && b.rescheduledFromId === bookingId;
      const repeat = await byKey(pool, idempotencyKey);
      if (repeat) return sameRequestOrConflict(repeat, isSameRequest);
      try {
        const id = await tx(async (client) => {
          const old = await client.query(`${BOOKING} where b.id = $1 and b.host_id = $2 for update of b`, [bookingId, hostId]);
          if (!old.rows[0]) throw new NotFoundError("Booking");
          const { eventTypeId, invitee } = toBooking(old.rows[0]);
          // Cancel first: the exclusion constraint only covers confirmed rows, so the new slot may overlap the old one.
          // Both statements commit together or not at all.
          await client.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest', cancel_reason = 'Rescheduled' where id = $1", [bookingId]);
          const { name, email, timezone, phone, answers } = invitee;
          const newId = await insertBooking(client, { eventTypeId, startAt, idempotencyKey, invitee: { name, email, timezone, phone, answers } }, bookingId);
          // Nothing more goes out about the old time; the new booking gets its own emails and reminders.
          // A calendar write already running for the old booking is left to finish; the move waits for it and then moves its event.
          await client.query(
            "update notifications set status = 'skipped', last_error = 'booking rescheduled', updated_at = now() where booking_id = $1 and status = 'queued' and not (channel = 'calendar' and locked_until > now())",
            [bookingId]);
          await queueBookingNotifications(client, newId, "rescheduled", new Date());
          // The guest already paid for the old time: the payment follows the booking, with no refund and no new charge.
          await client.query("update payments set booking_id = $2, updated_at = now() where booking_id = $1 and status = 'paid'", [bookingId, newId]);
          return newId;
        });
        kickJobs();
        return (await bookingWhere(pool, "b.id = $1", [id]))!;
      } catch (error) {
        return settle(error, idempotencyKey, isSameRequest);
      }
    },
    async cancelBooking(hostId, bookingId, by, reason) {
      if (!isId(hostId) || !isId(bookingId)) throw new NotFoundError("Booking");
      const cancelled = await tx(async (client) => {
        const { rowCount } = await client.query(
          "update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4 where id = $1 and host_id = $2 and status = 'confirmed'",
          [bookingId, hostId, by, reason ?? null]);
        if (rowCount) {
          await queueBookingNotifications(client, bookingId, "cancelled", new Date());
          // A paid booking is refunded in full (the guest cancel cutoff is enforced before this); the job runner does the refund.
          await client.query("update payments set status = 'refund_pending', updated_at = now(), checked_at = null where booking_id = $1 and status = 'paid'", [bookingId]);
        }
        return Boolean(rowCount);
      });
      if (cancelled) kickJobs();
      const booking = await bookingWhere(pool, "b.id = $1 and b.host_id = $2", [bookingId, hostId]);
      if (!booking) throw new NotFoundError("Booking");
      return booking;
    },
    async saveWeeklyHours(userId, scheduleId, byWeekday) {
      await tx(async (client) => {
        await ownedSchedule(client, userId, scheduleId);
        await client.query("delete from availability_rules where schedule_id = $1 and kind = 'weekly'", [scheduleId]);
        for (const [day, intervals] of Object.entries(byWeekday)) {
          if (intervals.length === 0) continue;
          await client.query("insert into availability_rules (schedule_id, kind, weekday, intervals) values ($1,'weekly',$2,$3)", [scheduleId, Number(day), JSON.stringify(intervals)]);
        }
      });
    },
    async saveDateOverride(userId, scheduleId, date, intervals) {
      await tx(async (client) => {
        await ownedSchedule(client, userId, scheduleId);
        await setOverride(client, scheduleId, date, intervals);
      });
    },
    async deleteDateOverride(userId, scheduleId, date) {
      await ownedSchedule(pool, userId, scheduleId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      await pool.query("delete from availability_rules where schedule_id = $1 and kind = 'date' and on_date = $2", [scheduleId, date]);
    },
    async blockDateRange(userId, scheduleId, from, to) {
      await tx(async (client) => {
        await ownedSchedule(client, userId, scheduleId);
        for (const date of datesInRange(from, to)) await setOverride(client, scheduleId, date, []);
      });
    },
    async createEventType(userId, draft) {
      return slugSafe(() => tx(async (client) => {
        const { rows } = await client.query(
          `insert into event_types (user_id, schedule_id, name, slug, description, duration_minutes, min_notice_minutes, booking_window_days, start_increment_minutes,
             buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, price_minor, currency, position)
           values ($1, (select id from availability_schedules where user_id = $1 and is_default), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             (select coalesce(max(position), -1) + 1 from event_types where user_id = $1))
           returning ${EVENT}`, [userId, ...draftValues(draft)]);
        const eventType = toEventType(rows[0]);
        await setLocation(client, eventType.id, draft);
        return eventType;
      }));
    },
    async updateEventType(userId, id, draft) {
      return slugSafe(() => tx(async (client) => {
        await owned(client, userId, id);
        const { rows } = await client.query(
          `update event_types set name = $3, slug = $4, description = $5, duration_minutes = $6, min_notice_minutes = $7, booking_window_days = $8,
             start_increment_minutes = $9, buffer_before_minutes = $10, buffer_after_minutes = $11, daily_limit = $12, cancel_cutoff_minutes = $13,
             price_minor = $14, currency = $15
           where user_id = $1 and id = $2 returning ${EVENT}`, [userId, id, ...draftValues(draft)]);
        await setLocation(client, id, draft);
        return toEventType(rows[0]);
      }));
    },
    async setEventTypeActive(userId, id, active) {
      await owned(pool, userId, id);
      const { rows } = await pool.query(`update event_types set active = $3 where user_id = $1 and id = $2 returning ${EVENT}`, [userId, id, active]);
      return toEventType(rows[0]);
    },
    async deleteEventType(userId, id, now = new Date()) {
      await tx(async (client) => {
        await owned(client, userId, id);
        const { rows } = await client.query(
          "select count(*)::int as used, count(*) filter (where status = 'confirmed' and start_at > $2)::int as upcoming from bookings where event_type_id = $1", [id, now]);
        if (rows[0].upcoming > 0) throw new EventTypeInUseError("upcoming", rows[0].upcoming);
        if (rows[0].used > 0) throw new EventTypeInUseError("history", 0);
        await client.query("delete from event_types where user_id = $1 and id = $2", [userId, id]); // locations and questions cascade
      });
    },
    async deleteAccount(userId, now = new Date()) {
      if (!isId(userId)) throw new NotFoundError("Account");
      const ids = await tx(async (client) => {
        const closed = await closeAccount(client, userId, now);
        // Guests of the cancelled bookings hear about it; the host, who is closing the account, does not.
        for (const id of closed ?? []) await queueBookingNotifications(client, id, "cancelled", now, { notifyHost: false });
        return closed;
      });
      if (ids === null) throw new NotFoundError("Account");
      if (ids.length > 0) kickJobs();
      if (ids.length === 0) return [];
      return (await pool.query(`${BOOKING} where b.id = any($1::uuid[]) order by b.start_at`, [ids])).rows.map(toBooking);
    },
    async purgeDeletedAccounts(now = new Date()) {
      return tx((client) => purgeClosedAccounts(client, now));
    },
    async saveQuestions(userId, eventTypeId, questions) {
      return tx(async (client) => {
        await owned(client, userId, eventTypeId);
        // Keep a client-sent id only when it already belongs to a question of this event type.
        const own = new Set((await client.query("select id from custom_questions where event_type_id = $1", [eventTypeId])).rows.map((r) => r.id as string));
        await client.query("delete from custom_questions where event_type_id = $1", [eventTypeId]);
        const saved = [];
        for (const [position, q] of questions.entries()) {
          const { rows } = await client.query(
            "insert into custom_questions (id, event_type_id, label, kind, required, choices, position) values (coalesce($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7) returning id",
            [q.id !== null && own.has(q.id) ? q.id : null, eventTypeId, q.label, q.kind, q.required, q.choices, position]);
          saved.push({ id: rows[0].id as string, eventTypeId, label: q.label, kind: q.kind, required: q.required, choices: [...q.choices], position });
        }
        return saved;
      });
    },
  };
}
