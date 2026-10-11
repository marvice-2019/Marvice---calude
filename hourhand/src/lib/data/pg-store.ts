import pg from "pg";
import { datesInRange } from "../availability";
import { kickJobs } from "../jobs/kick";
import { closeAccount, purgeClosedAccounts } from "./account-lifecycle";
import { queueBookingNotifications } from "./notifications";
import { PackageUnavailableError, takeCredits } from "../packages/packages";
import { hashLinkToken, newLinkToken } from "../links";
import { checkOneOff, oneOffSlug } from "./one-off";
import { queueWaitlistFor } from "../waitlist";
import {
  EventTypeInUseError, LinkUnavailableError, LinkUsedError, NotFoundError, RequestKeyConflictError, SlotTakenError, SlugTakenError, type AvailabilityRule, type BookingLink,
  type BookingWithInvitee, type CreateBookingInput, type DataStore, type EventType, type EventTypeDraft, type Interval, type User,
} from "./types";

const MIN = 60_000;
const WEEK = 7 * 24 * 60 * MIN;
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

const USER = "id, email, coalesce(name, '') as name, slug, timezone, time_format, locale";
const toUser = (r: Row): User => ({ id: r.id as string, email: r.email as string, name: r.name as string, slug: r.slug as string, timezone: r.timezone as string, timeFormat: r.time_format as User["timeFormat"], locale: r.locale as string });

const EVENT = `id, user_id, schedule_id, name, slug, description, duration_minutes, min_notice_minutes, booking_window_days, start_increment_minutes,
  buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, price_minor, currency, hidden, active, position, kind, max_repeats, deposit_minor, redirect_url, weekly_limit, cancellation_policy`;
const toEventType = (r: Row): EventType => ({
  id: r.id as string, userId: r.user_id as string, scheduleId: r.schedule_id as string | null, name: r.name as string, slug: r.slug as string,
  description: r.description as string | null, durationMinutes: r.duration_minutes as number, minNoticeMinutes: r.min_notice_minutes as number,
  bookingWindowDays: r.booking_window_days as number, startIncrementMinutes: r.start_increment_minutes as number, bufferBeforeMinutes: r.buffer_before_minutes as number,
  bufferAfterMinutes: r.buffer_after_minutes as number, dailyLimit: r.daily_limit as number | null, cancelCutoffMinutes: r.cancel_cutoff_minutes as number,
  priceMinor: r.price_minor as number | null, currency: r.currency as EventType["currency"], hidden: r.hidden as boolean, active: r.active as boolean, position: r.position as number,
  kind: r.kind as EventType["kind"], maxRepeats: r.max_repeats as number, depositMinor: (r.deposit_minor as number | null) ?? null, redirectUrl: (r.redirect_url as string | null) ?? null, weeklyLimit: (r.weekly_limit as number | null) ?? null, cancelPolicy: (r.cancellation_policy as string | null) ?? null,
});

const BOOKING = `select b.id, b.event_type_id, b.host_id, b.start_at, b.end_at, b.buffered_start, b.buffered_end, b.status, b.hold_expires_at, b.location_kind, b.join_url, b.idempotency_key,
  b.cancelled_at, b.cancelled_by, b.cancel_reason, b.rescheduled_from_id, b.series_id, b.series_index, b.created_at,
  i.id as invitee_id, i.name as invitee_name, i.email as invitee_email, i.timezone as invitee_timezone, i.phone as invitee_phone, i.answers, i.manage_token, i.no_show_at, i.running_late_minutes, i.running_late_at, i.guests::text[] as guests, i.locale as invitee_locale
  from bookings b join invitees i on i.booking_id = b.id`;
const toBooking = (r: Row): BookingWithInvitee => ({
  id: r.id as string, eventTypeId: r.event_type_id as string, hostId: r.host_id as string, startAt: r.start_at as Date, endAt: r.end_at as Date,
  bufferedStart: r.buffered_start as Date, bufferedEnd: r.buffered_end as Date, status: r.status as BookingWithInvitee["status"],
  holdExpiresAt: (r.hold_expires_at as Date | null) ?? null,
  locationKind: r.location_kind as BookingWithInvitee["locationKind"], joinUrl: (r.join_url as string | null) ?? null, idempotencyKey: r.idempotency_key as string, cancelledAt: r.cancelled_at as Date | null,
  cancelledBy: r.cancelled_by as BookingWithInvitee["cancelledBy"], cancelReason: r.cancel_reason as string | null, rescheduledFromId: r.rescheduled_from_id as string | null,
  seriesId: (r.series_id as string | null) ?? null, seriesIndex: (r.series_index as number | null) ?? null,
  createdAt: r.created_at as Date,
  invitee: {
    id: r.invitee_id as string, bookingId: r.id as string, hostId: r.host_id as string, name: r.invitee_name as string, email: r.invitee_email as string,
    timezone: r.invitee_timezone as string, phone: r.invitee_phone as string | null, answers: r.answers as BookingWithInvitee["invitee"]["answers"], manageToken: r.manage_token as string,
    noShowAt: (r.no_show_at as Date | null) ?? null,
    runningLateMinutes: (r.running_late_minutes as number | null) ?? null, runningLateAt: (r.running_late_at as Date | null) ?? null, guests: (r.guests as string[] | null) ?? [], locale: (r.invitee_locale as string | null) ?? "en",
  },
});

/** The derived "used" rule, over bookings aliased b: any booking made through the link except one the system cancelled. */
// A booking uses its link unless the system cancelled it, or it is a payment hold whose time has run out (the payment check
// cancels those within a minute; until then the guest must not be told the link is used).
const USES_LINK = "not ((b.status = 'cancelled' and b.cancelled_by = 'system') or (b.status = 'pending_payment' and b.hold_expires_at <= now()))";
const LINK = `select l.id, l.user_id, l.event_type_id, l.label, l.expires_at, l.revoked_at, l.created_at,
  u.id as used_booking_id, u.name as used_guest_name, u.start_at as used_start_at
  from booking_links l
  left join lateral (select b.id, i.name, b.start_at from bookings b join invitees i on i.booking_id = b.id
    where b.booking_link_id = l.id and ${USES_LINK} order by b.created_at desc limit 1) u on true`;
const toLink = (r: Row, now: Date): BookingLink => {
  const expiresAt = (r.expires_at as Date | null) ?? null;
  const revokedAt = (r.revoked_at as Date | null) ?? null;
  const usedBy = r.used_booking_id ? { bookingId: r.used_booking_id as string, guestName: r.used_guest_name as string, startAt: r.used_start_at as Date } : null;
  const state = usedBy ? "used" : revokedAt ? "revoked" : expiresAt && expiresAt.getTime() <= now.getTime() ? "expired" : "open";
  return { id: r.id as string, eventTypeId: r.event_type_id as string, label: (r.label as string | null) ?? null, expiresAt, revokedAt, createdAt: r.created_at as Date, state, usedBy };
};

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
  async function insertBooking(client: pg.PoolClient, input: CreateBookingInput, movingId: string | null, linkId: string | null = null): Promise<string> {
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
      `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, location_kind, idempotency_key, rescheduled_from_id, hold_expires_at, booking_link_id)
       values ($1,$2,$3,$4,$5,$6,$10,$7,$8,$9,$11,$12) returning id`,
      [input.eventTypeId, et.user_id, startAt, endAt, new Date(startAt.getTime() - et.buffer_before_minutes * MIN), new Date(endAt.getTime() + et.buffer_after_minutes * MIN),
        et.location_kind, input.idempotencyKey, movingId, input.holdUntil ? "pending_payment" : "confirmed", input.holdUntil ?? null, linkId]);
    const id = inserted.rows[0].id as string;
    const i = input.invitee;
    await client.query("insert into invitees (booking_id, host_id, name, email, timezone, phone, answers, guests, locale) values ($1,$2,$3,$4,$5,$6,$7,$8::citext[],$9)",
      [id, et.user_id, i.name, i.email, i.timezone, i.phone, JSON.stringify(i.answers), i.guests ?? [], i.locale ?? "en"]);
    return id;
  }

  /**
   * Cancels the event type's host's lapsed payment holds, freeing those slots. Their payments stay pending so the
   * reconciler still catches (and refunds) a payment that lands just after the hold ran out.
   */
  async function expireHolds(client: pg.PoolClient, eventTypeId: string): Promise<void> {
    await client.query(
      `update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancel_reason = 'Payment not completed', hold_expires_at = null
       where host_id = (select user_id from event_types where id = $1) and status = 'pending_payment' and hold_expires_at < now()`, [eventTypeId]);
  }

  /**
   * Uses up the single-use link for this booking, inside its transaction; returns the link id to record on it. The row
   * lock serialises bookings on one link, and the used check is a separate statement so its fresh snapshot sees a
   * booking the lock holder just committed.
   */
  async function takeLink(client: pg.PoolClient, input: CreateBookingInput, token: string): Promise<string> {
    if (!isId(input.eventTypeId)) throw new Error(`Unknown event type ${input.eventTypeId}`);
    // A lapsed payment hold made through the link frees it once cancelled by the system.
    await expireHolds(client, input.eventTypeId);
    const { rows } = await client.query("select id, event_type_id, expires_at, revoked_at from booking_links where token_hash = $1 for update", [hashLinkToken(token)]);
    const link = rows[0];
    if (!link || link.event_type_id !== input.eventTypeId) throw new LinkUnavailableError("not_found");
    // The same request again (same key) isn't a second use: the insert below returns that booking instead.
    const used = await client.query(`select 1 from bookings b where b.booking_link_id = $1 and ${USES_LINK} and b.idempotency_key <> $2`, [link.id, input.idempotencyKey]);
    if (used.rowCount) throw new LinkUsedError();
    if (link.revoked_at) throw new LinkUnavailableError("revoked");
    if (link.expires_at && (link.expires_at as Date).getTime() <= Date.now()) throw new LinkUnavailableError("expired");
    return link.id as string;
  }

  async function linkRows(db: Db, where: string, values: unknown[], now: Date): Promise<{ userId: string; link: BookingLink }[]> {
    const { rows } = await db.query(`${LINK} where ${where} order by l.created_at desc`, values);
    return rows.map((r) => ({ userId: r.user_id as string, link: toLink(r, now) }));
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
    d.bufferBeforeMinutes, d.bufferAfterMinutes, d.dailyLimit, d.cancelCutoffMinutes, d.priceMinor, d.priceMinor === null ? null : d.currency, d.hidden, d.maxRepeats, d.priceMinor === null ? d.depositMinor : null, d.redirectUrl, d.weeklyLimit, d.cancelPolicy];

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
    async setUserLocale(userId, locale) {
      await pool.query(`update users set locale = $2 where id = $1`, [userId, locale]);
    },
    async getUserBySlug(slug) {
      const { rows } = await pool.query(`select ${USER} from users where slug = $1 and deleted_at is null`, [slug]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async listEventTypes(userId) {
      if (!isId(userId)) return [];
      return (await pool.query(`select ${EVENT} from event_types where user_id = $1 and kind <> 'one_off' order by position, created_at`, [userId])).rows.map(toEventType);
    },
    async getEventType(userId, id) {
      if (!isId(userId) || !isId(id)) return null;
      const { rows } = await pool.query(`select ${EVENT} from event_types where user_id = $1 and id = $2`, [userId, id]);
      return rows[0] ? toEventType(rows[0]) : null;
    },
    async getPublicEventType(hostSlug, eventSlug) {
      const host = await this.getUserBySlug(hostSlug);
      if (!host) return null;
      const { rows } = await pool.query(`select ${EVENT} from event_types where user_id = $1 and slug = $2 and active and kind <> 'one_off'`, [host.id, eventSlug]);
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
          const linkId = input.bookingLinkToken === undefined ? null : await takeLink(client, input, input.bookingLinkToken);
          const weekStarts = Array.from({ length: input.weeks ?? 1 }, (_, i) => new Date(input.startAt.getTime() + i * WEEK));
          const purchaseId = input.packageToken === undefined ? null : await takeCredits(client, input.packageToken, input.eventTypeId, weekStarts);
          const newId = await insertBooking(client, input, null, linkId);
          // A held booking says nothing yet: its emails and calendar write go out once the payment is confirmed.
          if (!input.holdUntil) await queueBookingNotifications(client, newId, "booked", new Date());
          // A weekly series: the later weeks commit with the first or not at all. The first week's confirmation lists
          // every date; each week still gets its own reminders and calendar event.
          const weeks = input.weeks ?? 1;
          if (weeks > 1) {
            await client.query("update bookings set series_id = id, series_index = 1 where id = $1", [newId]);
            for (let i = 2; i <= weeks; i++) {
              const weekId = await insertBooking(client, { ...input, startAt: new Date(input.startAt.getTime() + (i - 1) * WEEK), idempotencyKey: `${input.idempotencyKey}#${i}` }, null, null);
              await client.query("update bookings set series_id = $2, series_index = $3 where id = $1", [weekId, newId, i]);
              await queueBookingNotifications(client, weekId, "booked", new Date(), { confirm: false });
            }
          }
          if (purchaseId) await client.query("update bookings set package_purchase_id = $2 where id = $1 or series_id = $1", [newId, purchaseId]);
          return newId;
        });
        kickJobs();
        return (await bookingWhere(pool, "b.id = $1", [id]))!;
      } catch (error) {
        return settle(error, input.idempotencyKey, isSameRequest);
      }
    },
    async createOneOffMeeting(hostId, input, now) {
      if (!isId(hostId)) throw new NotFoundError("User");
      const times = checkOneOff(input, now);
      const token = newLinkToken();
      const { eventType, linkId } = await tx(async (client) => {
        const { rows } = await client.query(
          `insert into event_types (user_id, schedule_id, name, slug, description, duration_minutes, min_notice_minutes, booking_window_days, buffer_before_minutes, buffer_after_minutes, kind, hidden)
           values ($1, (select id from availability_schedules where user_id = $1 and is_default), $2, $3, $4, $5, 0, 730, 0, 0, 'one_off', true)
           returning ${EVENT}`, [hostId, input.name.trim(), oneOffSlug(), input.description ?? null, input.durationMinutes]);
        const created = toEventType(rows[0]);
        await client.query("insert into event_locations (event_type_id, kind, value, position) values ($1,$2,$3,0)", [created.id, input.location.kind, input.location.value ?? null]);
        await client.query("insert into one_off_times (event_type_id, start_at) select $1, unnest($2::timestamptz[])", [created.id, times]);
        const link = await client.query("insert into booking_links (user_id, event_type_id, token_hash, expires_at) values ($1,$2,$3,$4) returning id",
          [hostId, created.id, hashLinkToken(token), times[times.length - 1]]);
        return { eventType: created, linkId: link.rows[0].id as string };
      });
      const [{ link }] = await linkRows(pool, "l.id = $1", [linkId], now);
      return { eventType, link, token };
    },
    async listOneOffTimes(eventTypeId) {
      if (!isId(eventTypeId)) return [];
      return (await pool.query("select start_at from one_off_times where event_type_id = $1 order by start_at", [eventTypeId])).rows.map((r) => r.start_at as Date);
    },
    async rescheduleBooking(hostId, bookingId, startAt, idempotencyKey, by = "guest") {
      if (!isId(hostId) || !isId(bookingId)) throw new NotFoundError("Booking");
      const isSameRequest = (b: BookingWithInvitee) => b.hostId === hostId && b.rescheduledFromId === bookingId;
      const repeat = await byKey(pool, idempotencyKey);
      if (repeat) return sameRequestOrConflict(repeat, isSameRequest);
      try {
        const id = await tx(async (client) => {
          const old = await client.query(`${BOOKING} where b.id = $1 and b.host_id = $2 and b.status = 'confirmed' for update of b`, [bookingId, hostId]);
          if (!old.rows[0]) throw new NotFoundError("Booking");
          const { eventTypeId, invitee } = toBooking(old.rows[0]);
          // Cancel first: the exclusion constraint only covers confirmed rows, so the new slot may overlap the old one.
          // Both statements commit together or not at all.
          await client.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'Rescheduled' where id = $1", [bookingId, by]);
          const { name, email, timezone, phone, answers, guests, locale } = invitee;
          // The move keeps the booking's single-use link, so the link shows the current time.
          const linkId = (await client.query("select booking_link_id from bookings where id = $1", [bookingId])).rows[0].booking_link_id as string | null;
          const newId = await insertBooking(client, { eventTypeId, startAt, idempotencyKey, invitee: { name, email, timezone, phone, answers, guests, locale } }, bookingId, linkId);
          // A moved week stays its series' week: same series, same place in it. A package session stays paid for by its
          // package (or its credit would come back while still booked), and can't move past the package's end date.
          await client.query(
            "update bookings n set series_id = o.series_id, series_index = o.series_index, package_purchase_id = o.package_purchase_id from bookings o where n.id = $1 and o.id = $2",
            [newId, bookingId]);
          const { rows: [pk] } = await client.query(
            "select p.expires_at from package_purchases p where p.id = (select package_purchase_id from bookings where id = $1) for update", [bookingId]);
          if (pk && startAt.getTime() >= new Date(pk.expires_at).getTime()) throw new PackageUnavailableError("expired");
          // Nothing more goes out about the old time; the new booking gets its own emails and reminders.
          // A calendar write already running for the old booking is left to finish; the move waits for it and then moves its event.
          await client.query(
            "update notifications set status = 'skipped', last_error = 'booking rescheduled', updated_at = now() where booking_id = $1 and status = 'queued' and not (channel = 'calendar' and locked_until > now())",
            [bookingId]);
          await queueBookingNotifications(client, newId, "rescheduled", new Date());
          await queueWaitlistFor(client, bookingId, new Date()); // the old time is free now
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
    async cancelBooking(hostId, bookingId, by, reason, opts = {}) {
      if (!isId(hostId) || !isId(bookingId)) throw new NotFoundError("Booking");
      const cancelled = await tx(async (client) => {
        const { rowCount } = await client.query(
          "update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4 where id = $1 and host_id = $2 and status = 'confirmed'",
          [bookingId, hostId, by, reason ?? null]);
        if (rowCount && opts.laterWeeks) {
          // The series' later weeks still to come, cancelled at the same instant (now() is fixed per transaction), which
          // is how the cancellation email finds them. Each still loses its reminders and calendar event.
          const { rows: later } = await client.query(
            `update bookings w set status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4
             from bookings b where b.id = $1 and b.host_id = $2 and b.series_id is not null and w.series_id = b.series_id and w.series_index > b.series_index
               and w.status = 'confirmed' and w.start_at > now() returning w.id`, [bookingId, hostId, by, reason ?? null]);
          for (const w of later) {
            await queueBookingNotifications(client, w.id, "cancelled", new Date(), { confirm: false });
            await queueWaitlistFor(client, w.id, new Date());
          }
        }
        if (rowCount) {
          await queueBookingNotifications(client, bookingId, "cancelled", new Date());
          await queueWaitlistFor(client, bookingId, new Date());
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
    async setNoShow(hostId, bookingId, on, now) {
      if (!isId(hostId) || !isId(bookingId)) throw new NotFoundError("Booking");
      // Only the host's own booking, and only once it has started: nobody can have missed it before then.
      const { rowCount } = await pool.query(
        "update invitees i set no_show_at = $3 from bookings b where b.id = i.booking_id and b.id = $1 and b.host_id = $2 and b.status = 'confirmed' and b.start_at <= $4",
        [bookingId, hostId, on ? now : null, now]);
      if (!rowCount) throw new NotFoundError("Booking");
      return (await bookingWhere(pool, "b.id = $1 and b.host_id = $2", [bookingId, hostId]))!;
    },
    async getClientNote(hostId, email) {
      if (!isId(hostId)) return "";
      const { rows: [r] } = await pool.query("select note from client_notes where host_id = $1 and email = $2", [hostId, email]);
      return (r?.note as string | undefined) ?? "";
    },
    async saveClientNote(hostId, email, note) {
      if (!isId(hostId)) throw new NotFoundError("User");
      if (note.trim() === "") await pool.query("delete from client_notes where host_id = $1 and email = $2", [hostId, email]);
      else await pool.query(
        `insert into client_notes (host_id, email, note) values ($1, $2, $3)
         on conflict (host_id, email) do update set note = $3, updated_at = now()`, [hostId, email, note]);
    },
    async markRunningLate(manageToken, minutes, now) {
      return tx(async (client) => {
        // Only a confirmed booking. The host is emailed in the same write whenever the answer changes, so a double tap
        // sends once but 15, then 5, then 15 again sends three. The key carries the minutes the email reports.
        const { rows: [prev] } = await client.query(
          `select i.id, i.running_late_minutes, b.id as booking_id, b.host_id from invitees i join bookings b on b.id = i.booking_id
           where i.manage_token = $1 and b.status = 'confirmed' for update of i`, [manageToken]);
        if (!prev) throw new NotFoundError("Booking");
        const { booking_id: id, host_id: hostId } = prev;
        await client.query("update invitees set running_late_minutes = $2, running_late_at = $3 where id = $1", [prev.id, minutes, now]);
        if (prev.running_late_minutes !== minutes) {
          await client.query(
            `insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
             select $1, $2, 'email', 'late_host', u.email, $3, $4 from users u where u.id = $2 on conflict (dedupe_key) do nothing`,
            [id, hostId, now, `booking:${id}:late:${minutes}:${now.getTime()}`]);
        }
        return (await bookingWhere(client, "b.id = $1", [id]))!;
      }).then((booking) => { kickJobs(); return booking; });
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
             buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, price_minor, currency, hidden, max_repeats, deposit_minor, redirect_url, weekly_limit, cancellation_policy, position)
           values ($1, (select id from availability_schedules where user_id = $1 and is_default), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
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
             price_minor = $14, currency = $15, hidden = $16, max_repeats = $17, deposit_minor = $18, redirect_url = $19, weekly_limit = $20, cancellation_policy = $21
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
          `select count(*)::int as used, count(*) filter (where status = 'confirmed' and start_at > $2)::int as upcoming,
             (select count(*)::int from package_purchases where event_type_id = $1) as sold
           from bookings where event_type_id = $1`, [id, now]);
        if (rows[0].upcoming > 0) throw new EventTypeInUseError("upcoming", rows[0].upcoming);
        // A package sold for it is a record of money paid: keep the event type (it can be turned off instead).
        if (rows[0].used > 0 || rows[0].sold > 0) throw new EventTypeInUseError("history", 0);
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
    async createBookingLink(hostId, eventTypeId, opts, now) {
      const eventType = await owned(pool, hostId, eventTypeId);
      // A one-off meeting has exactly one link, made with it; a second would let it be booked twice.
      if (!eventType.active || eventType.kind === "one_off") throw new NotFoundError("Event type");
      const token = newLinkToken();
      const { rows } = await pool.query("insert into booking_links (user_id, event_type_id, token_hash, label, expires_at) values ($1,$2,$3,$4,$5) returning id",
        [hostId, eventTypeId, hashLinkToken(token), opts.label ?? null, opts.expiresAt ?? null]);
      const [{ link }] = await linkRows(pool, "l.id = $1", [rows[0].id], now);
      return { link, token };
    },
    async listBookingLinks(hostId, now) {
      if (!isId(hostId)) return [];
      return (await linkRows(pool, "l.user_id = $1", [hostId], now)).map((r) => r.link);
    },
    async revokeBookingLink(hostId, linkId, now) {
      if (!isId(hostId) || !isId(linkId)) throw new NotFoundError("Booking link");
      return tx(async (client) => {
        // Locked like a booking through it would, so a revoke and a booking can't both win.
        const locked = await client.query("select 1 from booking_links where id = $1 and user_id = $2 for update", [linkId, hostId]);
        if (!locked.rowCount) throw new NotFoundError("Booking link");
        const [{ link }] = await linkRows(client, "l.id = $1", [linkId], now);
        if (link.state !== "open") throw new NotFoundError("Booking link");
        await client.query("update booking_links set revoked_at = $2 where id = $1", [linkId, now]);
        return { ...link, revokedAt: now, state: "revoked" as const };
      });
    },
    async resolveBookingLink(token, now, opts) {
      const [found] = await linkRows(pool, "l.token_hash = $1", [hashLinkToken(token)], now);
      if (!found) return { status: "not_found" };
      // A retried submit (same key) whose booking is what uses the link still reaches it, so it gets its booking back.
      const usedOnlyByThisRequest = found.link.state === "used" && opts?.idempotencyKey !== undefined && !(await pool.query(
        `select 1 from bookings b where b.booking_link_id = $1 and ${USES_LINK} and b.idempotency_key <> $2`, [found.link.id, opts.idempotencyKey])).rowCount;
      if (found.link.state !== "open" && !usedOnlyByThisRequest) return { status: found.link.state };
      // A closed account or a link turned off reads as unknown: nothing about the host leaks.
      const host = await this.getUser(found.userId);
      const eventType = host && await this.getEventType(host.id, found.link.eventTypeId);
      if (!host || !eventType?.active) return { status: "not_found" };
      return { status: "open", link: found.link, host, eventType };
    },
  };
}
