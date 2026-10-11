import pg from "pg";
import { datesInRange } from "../availability";
import {
  EventTypeInUseError, SlotTakenError, SlugTakenError, type AvailabilityRule, type BookingWithInvitee, type CreateBookingInput, type DataStore,
  type EventType, type EventTypeDraft, type Interval, type User,
} from "./types";

const MIN = 60_000;
/** Until auth lands, the current user is the seeded demo host. */
const CURRENT_USER_SLUG = "priya";
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
  buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, hidden, active, position`;
const toEventType = (r: Row): EventType => ({
  id: r.id as string, userId: r.user_id as string, scheduleId: r.schedule_id as string | null, name: r.name as string, slug: r.slug as string,
  description: r.description as string | null, durationMinutes: r.duration_minutes as number, minNoticeMinutes: r.min_notice_minutes as number,
  bookingWindowDays: r.booking_window_days as number, startIncrementMinutes: r.start_increment_minutes as number, bufferBeforeMinutes: r.buffer_before_minutes as number,
  bufferAfterMinutes: r.buffer_after_minutes as number, dailyLimit: r.daily_limit as number | null, cancelCutoffMinutes: r.cancel_cutoff_minutes as number,
  hidden: r.hidden as boolean, active: r.active as boolean, position: r.position as number,
});

const BOOKING = `select b.id, b.event_type_id, b.host_id, b.start_at, b.end_at, b.buffered_start, b.buffered_end, b.status, b.location_kind, b.idempotency_key,
  b.cancelled_at, b.cancelled_by, b.cancel_reason, b.rescheduled_from_id, b.created_at,
  i.id as invitee_id, i.name as invitee_name, i.email as invitee_email, i.timezone as invitee_timezone, i.phone as invitee_phone, i.answers, i.manage_token
  from bookings b join invitees i on i.booking_id = b.id`;
const toBooking = (r: Row): BookingWithInvitee => ({
  id: r.id as string, eventTypeId: r.event_type_id as string, hostId: r.host_id as string, startAt: r.start_at as Date, endAt: r.end_at as Date,
  bufferedStart: r.buffered_start as Date, bufferedEnd: r.buffered_end as Date, status: r.status as BookingWithInvitee["status"],
  locationKind: r.location_kind as BookingWithInvitee["locationKind"], idempotencyKey: r.idempotency_key as string, cancelledAt: r.cancelled_at as Date | null,
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

  /** Inserts a confirmed booking and its invitee. The no_double_booking constraint is the overlap guard (23P01). */
  async function insertBooking(client: pg.PoolClient, input: CreateBookingInput, movingId: string | null): Promise<string> {
    if (!isId(input.eventTypeId)) throw new Error(`Unknown event type ${input.eventTypeId}`);
    const { rows } = await client.query(
      `select e.user_id, e.duration_minutes, e.buffer_before_minutes, e.buffer_after_minutes,
         (select kind from event_locations l where l.event_type_id = e.id order by position limit 1) as location_kind
       from event_types e where e.id = $1`, [input.eventTypeId]);
    const et = rows[0];
    if (!et) throw new Error(`Unknown event type ${input.eventTypeId}`);
    const startAt = input.startAt;
    const endAt = new Date(startAt.getTime() + et.duration_minutes * MIN);
    const inserted = await client.query(
      `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, location_kind, idempotency_key, rescheduled_from_id)
       values ($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9) returning id`,
      [input.eventTypeId, et.user_id, startAt, endAt, new Date(startAt.getTime() - et.buffer_before_minutes * MIN), new Date(endAt.getTime() + et.buffer_after_minutes * MIN),
        et.location_kind, input.idempotencyKey, movingId]);
    const id = inserted.rows[0].id as string;
    const i = input.invitee;
    await client.query("insert into invitees (booking_id, host_id, name, email, timezone, phone, answers) values ($1,$2,$3,$4,$5,$6,$7)",
      [id, et.user_id, i.name, i.email, i.timezone, i.phone, JSON.stringify(i.answers)]);
    return id;
  }

  /** A lost race on the idempotency key returns the winner's booking; a lost race on the slot is SlotTakenError. */
  async function settle(error: unknown, idempotencyKey: string): Promise<BookingWithInvitee> {
    if (code(error) === "23505" || code(error) === "23P01") {
      const winner = await byKey(pool, idempotencyKey);
      if (winner) return winner;
      if (code(error) === "23P01") throw new SlotTakenError();
    }
    throw error;
  }

  async function owned(db: Db, userId: string, id: string): Promise<EventType> {
    const { rows } = isId(userId) && isId(id) ? await db.query(`select ${EVENT} from event_types where user_id = $1 and id = $2`, [userId, id]) : { rows: [] };
    if (!rows[0]) throw new Error(`Unknown event type ${id}`);
    return toEventType(rows[0]);
  }

  async function setLocation(client: pg.PoolClient, eventTypeId: string, draft: EventTypeDraft) {
    await client.query("delete from event_locations where event_type_id = $1", [eventTypeId]);
    if (draft.location) await client.query("insert into event_locations (event_type_id, kind, value, position) values ($1,$2,$3,0)", [eventTypeId, draft.location.kind, draft.location.value]);
  }

  const draftValues = (d: EventTypeDraft) => [d.name, d.slug, d.description, d.durationMinutes, d.minNoticeMinutes, d.bookingWindowDays, d.startIncrementMinutes,
    d.bufferBeforeMinutes, d.bufferAfterMinutes, d.dailyLimit, d.cancelCutoffMinutes];

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
      const user = await this.getUserBySlug(CURRENT_USER_SLUG);
      if (!user) throw new Error(`The demo host "${CURRENT_USER_SLUG}" is missing; run npm run db:seed`);
      return user;
    },
    async getUser(id) {
      if (!isId(id)) return null;
      const { rows } = await pool.query(`select ${USER} from users where id = $1`, [id]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async getUserBySlug(slug) {
      const { rows } = await pool.query(`select ${USER} from users where slug = $1`, [slug]);
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
    async listEventLocations(eventTypeId) {
      if (!isId(eventTypeId)) return [];
      const { rows } = await pool.query("select id, event_type_id, kind, value, position from event_locations where event_type_id = $1 order by position", [eventTypeId]);
      return rows.map((r) => ({ id: r.id, eventTypeId: r.event_type_id, kind: r.kind, value: r.value, position: r.position }));
    },
    async listCustomQuestions(eventTypeId) {
      if (!isId(eventTypeId)) return [];
      const { rows } = await pool.query("select id, event_type_id, label, kind, required, choices, position from custom_questions where event_type_id = $1 order by position", [eventTypeId]);
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
      const { rows } = await pool.query("select id, connection_id, user_id, name, check_conflicts, is_add_to from calendars where user_id = $1 order by created_at", [userId]);
      return rows.map((r) => ({ id: r.id, connectionId: r.connection_id, userId: r.user_id, name: r.name, checkConflicts: r.check_conflicts, isAddTo: r.is_add_to }));
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
      const repeat = await byKey(pool, input.idempotencyKey);
      if (repeat) return repeat;
      try {
        const id = await tx((client) => insertBooking(client, input, null));
        return (await bookingWhere(pool, "b.id = $1", [id]))!;
      } catch (error) {
        return settle(error, input.idempotencyKey);
      }
    },
    async rescheduleBooking(bookingId, startAt, idempotencyKey) {
      const repeat = await byKey(pool, idempotencyKey);
      if (repeat) return repeat;
      if (!isId(bookingId)) throw new Error(`Unknown booking ${bookingId}`);
      try {
        const id = await tx(async (client) => {
          const old = await client.query(`${BOOKING} where b.id = $1 for update of b`, [bookingId]);
          if (!old.rows[0]) throw new Error(`Unknown booking ${bookingId}`);
          const { eventTypeId, invitee } = toBooking(old.rows[0]);
          // Cancel first: the exclusion constraint only covers confirmed rows, so the new slot may overlap the old one.
          // Both statements commit together or not at all.
          await client.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest', cancel_reason = 'Rescheduled' where id = $1", [bookingId]);
          const { name, email, timezone, phone, answers } = invitee;
          return insertBooking(client, { eventTypeId, startAt, idempotencyKey, invitee: { name, email, timezone, phone, answers } }, bookingId);
        });
        return (await bookingWhere(pool, "b.id = $1", [id]))!;
      } catch (error) {
        return settle(error, idempotencyKey);
      }
    },
    async cancelBooking(bookingId, by, reason) {
      if (!isId(bookingId)) throw new Error(`Unknown booking ${bookingId}`);
      await pool.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 where id = $1 and status = 'confirmed'", [bookingId, by, reason ?? null]);
      const booking = await bookingWhere(pool, "b.id = $1", [bookingId]);
      if (!booking) throw new Error(`Unknown booking ${bookingId}`);
      return booking;
    },
    async saveWeeklyHours(scheduleId, byWeekday) {
      if (!isId(scheduleId)) return;
      await tx(async (client) => {
        await client.query("delete from availability_rules where schedule_id = $1 and kind = 'weekly'", [scheduleId]);
        for (const [day, intervals] of Object.entries(byWeekday)) {
          if (intervals.length === 0) continue;
          await client.query("insert into availability_rules (schedule_id, kind, weekday, intervals) values ($1,'weekly',$2,$3)", [scheduleId, Number(day), JSON.stringify(intervals)]);
        }
      });
    },
    async saveDateOverride(scheduleId, date, intervals) {
      if (!isId(scheduleId)) return;
      await tx((client) => setOverride(client, scheduleId, date, intervals));
    },
    async deleteDateOverride(scheduleId, date) {
      if (!isId(scheduleId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      await pool.query("delete from availability_rules where schedule_id = $1 and kind = 'date' and on_date = $2", [scheduleId, date]);
    },
    async blockDateRange(scheduleId, from, to) {
      if (!isId(scheduleId)) return;
      await tx(async (client) => {
        for (const date of datesInRange(from, to)) await setOverride(client, scheduleId, date, []);
      });
    },
    async createEventType(userId, draft) {
      return slugSafe(() => tx(async (client) => {
        const { rows } = await client.query(
          `insert into event_types (user_id, schedule_id, name, slug, description, duration_minutes, min_notice_minutes, booking_window_days, start_increment_minutes,
             buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, position)
           values ($1, (select id from availability_schedules where user_id = $1 and is_default), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
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
             start_increment_minutes = $9, buffer_before_minutes = $10, buffer_after_minutes = $11, daily_limit = $12, cancel_cutoff_minutes = $13
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
    async saveQuestions(eventTypeId, questions) {
      if (!isId(eventTypeId)) throw new Error(`Unknown event type ${eventTypeId}`);
      return tx(async (client) => {
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
