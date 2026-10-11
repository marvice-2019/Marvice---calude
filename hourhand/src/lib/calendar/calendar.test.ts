// Google Calendar against real Postgres, with an in-process fake of Google. Runs only with TEST_DATABASE_URL; uses its
// own database (<name>_cal), dropped and recreated on every run.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { hostPlan } from "../billing/account";
import { unseal } from "../crypto/seal";
import { createPgStore } from "../data/pg-store";
import type { DataStore, EventType, User } from "../data/types";
import type { Mail, Mailer } from "../mail/mailer";
import { MEET_LINK_WAIT_SECONDS, processDueNotifications } from "../jobs/worker";
import { calendarConfigError, calendarDeps } from "./env";
import { accessTokenFor, disconnectConnection, saveConnection, setAddToCalendar, setCheckConflicts } from "./connections";
import { eventIdFor, GoogleApiError, REQUIRED_SCOPES, type BusyRange, type EventInput, type GoogleClient } from "./google";
import { CalendarApiError, type CalendarProvider } from "./provider";
import { ALERT_AFTER_FAILURES, recordConnectionFailure, syncDueConnections } from "./sync";

const BASE = process.env.TEST_DATABASE_URL;
const MIN = 60_000;
const baseUrl = "https://hourhand.test";
const guest = { name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: null, answers: [] };

interface FakeEvent { calendarId: string; start: Date; end: Date; summary: string; attendee: string; withMeet: boolean }

/** Just enough of Google for the app: tokens, free/busy and events, with switches to make each call fail. */
function fakeGoogle() {
  const s = {
    busy: new Map<string, BusyRange[]>(),
    events: new Map<string, FakeEvent>(),
    refreshes: 0,
    revoked: [] as string[],
    failRefresh: null as GoogleApiError | null,
    failFreeBusy: null as GoogleApiError | null,
    failInsert: null as GoogleApiError | null,
    /** Calendars Google answers with an error for, as free/busy does for a deleted or unshared calendar. */
    freeBusyErrors: new Map<string, string>(),
    busyTimeZone: undefined as string | undefined,
    /** When set, event creation waits for it: a write that is still running when something else happens. */
    insertGate: null as Promise<void> | null,
    /** Runs during a free/busy call: something the host does while a sync is in progress. */
    duringFreeBusy: null as (() => Promise<void>) | null,
  };
  const meet = (id: string) => `https://meet.google.com/${id.slice(2, 5)}-${id.slice(5, 9)}-${id.slice(9, 12)}`;
  const g = {
    async refresh() {
      if (s.failRefresh) throw s.failRefresh;
      s.refreshes++;
      return { accessToken: `at-${s.refreshes}`, expiresAt: new Date(Date.now() + 3600_000) };
    },
    async revoke(token: string) { s.revoked.push(token); },
    async busy(_t: string, ids: string[], _from?: Date, _until?: Date, opts?: { timeZone?: string }) {
      s.busyTimeZone = opts?.timeZone;
      if (s.failFreeBusy) throw s.failFreeBusy;
      if (s.duringFreeBusy) { const run = s.duringFreeBusy; s.duringFreeBusy = null; await run(); }
      const ok = ids.filter((id) => !s.freeBusyErrors.has(id));
      return { busy: new Map(ok.map((id) => [id, s.busy.get(id) ?? []])), errors: new Map([...s.freeBusyErrors].filter(([id]) => ids.includes(id))) };
    },
    async insertEvent(_t: string, calendarId: string, e: EventInput) {
      if (s.failInsert) throw s.failInsert;
      if (s.insertGate) await s.insertGate;
      const id = eventIdFor(e.bookingId);
      s.events.set(id, { calendarId, start: e.start, end: e.end, summary: e.summary, attendee: e.attendee.email, withMeet: e.conference === "google_meet" });
      return { id, joinUrl: e.conference === "google_meet" ? meet(id) : null, conferencePending: false };
    },
    async getEvent(_t: string, _c: string, id: string) {
      return { id, joinUrl: s.events.get(id)?.withMeet ? meet(id) : null, conferencePending: false };
    },
    async moveEvent(_t: string, _c: string, id: string, start: Date, end: Date) {
      const e = s.events.get(id)!;
      s.events.set(id, { ...e, start, end });
      return { id, joinUrl: e.withMeet ? meet(id) : null, conferencePending: false };
    },
    async deleteEvent(_t: string, _c: string, id: string) { s.events.delete(id); },
  };
  return { google: g as unknown as GoogleClient, s };
}

/** Just enough of Microsoft Graph: Teams links are created asynchronously, and appear once `linkReady` is set. */
function fakeMicrosoft(teams = true) {
  const s = { events: new Map<string, { calendarId: string; start: Date; end: Date; withTeams: boolean }>(), linkReady: false, getEvents: 0 };
  const link = (id: string) => `https://teams.microsoft.com/l/meetup-join/${id}`;
  const result = (id: string) => {
    const e = s.events.get(id);
    if (!e?.withTeams) return { id, joinUrl: null, conferencePending: false };
    return s.linkReady ? { id, joinUrl: link(id), conferencePending: false } : { id, joinUrl: null, conferencePending: true };
  };
  const m = {
    id: "microsoft",
    async refresh() { throw new Error("the access token in these tests never needs a refresh"); },
    async revoke() {},
    missingScopes: () => [],
    async listCalendars() { return [{ id: "ms-cal", name: "Calendar", primary: true, accessRole: "owner", teams }]; },
    async busy(_t: string, ids: string[]) { return { busy: new Map(ids.map((id) => [id, []])), errors: new Map() }; },
    async insertEvent(_t: string, calendarId: string, e: EventInput) {
      const id = `ms-${e.bookingId}`;
      s.events.set(id, { calendarId, start: e.start, end: e.end, withTeams: e.conference === "teams" });
      return { id, joinUrl: null, conferencePending: e.conference === "teams" };
    },
    async getEvent(_t: string, _c: string, id: string) { s.getEvents++; return result(id); },
    async moveEvent(_t: string, _c: string, id: string, start: Date, end: Date) {
      s.events.set(id, { ...s.events.get(id)!, start, end });
      return result(id);
    },
    async deleteEvent(_t: string, _c: string, id: string) { s.events.delete(id); },
  };
  return { microsoft: m as unknown as CalendarProvider, s };
}

function recordingMailer() {
  const sent: Mail[] = [];
  const mailer: Mailer = { async send(m) { sent.push(m); return { id: `m-${sent.length}` }; } };
  return { mailer, sent };
}

describe.skipIf(!BASE)("Google Calendar (TEST_DATABASE_URL)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let arun: User;
  let coaching: EventType;
  const key = randomBytes(32);
  let slot = 0;
  const nextStart = () => new Date(Date.UTC(2032, 0, 5 + slot++, 4, 0));

  const tokens = (email: string, scope = ["openid", "email", ...REQUIRED_SCOPES].join(" ")) =>
    ({ accessToken: "at-0", refreshToken: "rt-for-tests", expiresAt: new Date(Date.now() + 3600_000), scope, email });
  const cals = [
    { id: "priya@gmail.com", name: "Priya", primary: true, accessRole: "owner" as const },
    { id: "team@group.calendar.google.com", name: "Team", primary: false, accessRole: "reader" as const },
  ];
  const connect = (user: User, email = "priya@gmail.com") => saveConnection(pool, key, user.id, "google", tokens(email), cals, new Date());
  const conn = async (id: string) => (await pool.query("select * from calendar_connections where id = $1", [id])).rows[0];
  const calendarRows = async (userId: string) => (await pool.query("select id, external_id, check_conflicts, is_add_to from calendars where user_id = $1 order by name", [userId])).rows;
  const queue = async (bookingId: string) =>
    (await pool.query("select kind, channel, status, last_error from notifications where booking_id = $1 order by kind", [bookingId])).rows;

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_cal`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`drop database if exists ${name} with (force)`);
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    await migrate(u.toString());
    await seed(u.toString());
    pool = new pg.Pool({ connectionString: u.toString() });
    store = createPgStore(pool);
    priya = (await store.getUserBySlug("priya"))!;
    arun = (await store.getUserBySlug("arun"))!;
    coaching = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // Every test starts with no connections (the demo one included) and an empty queue.
    await pool.query("delete from calendar_connections");
    await pool.query("update notifications set status = 'skipped' where status = 'queued'");
  });

  describe("connecting", () => {
    it("stores the tokens sealed, checks the primary calendar and adds bookings to it", async () => {
      const id = await connect(priya);
      const row = await conn(id);
      expect(row.credentials_encrypted.toString("latin1")).not.toContain("rt-for-tests");
      expect(row.status).toBe("ok");
      const list = await store.listCalendars(priya.id);
      expect(list.find((c) => c.name === "Priya")).toMatchObject({ checkConflicts: true, isAddTo: true, canWrite: true });
      expect(list.find((c) => c.name === "Team")).toMatchObject({ checkConflicts: false, isAddTo: false, canWrite: false });
    });

    it("reconnecting the same account updates it instead of adding a second one", async () => {
      await connect(priya);
      await connect(priya);
      expect((await store.listCalendarConnections(priya.id))).toHaveLength(1);
    });

    it("refreshes an expired access token and stores the new one sealed", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      expect(await accessTokenFor(pool, { google }, key, id)).toBe("at-0");
      expect(await accessTokenFor(pool, { google }, key, id, new Date(Date.now() + 2 * 3600_000))).toBe("at-1");
      expect(s.refreshes).toBe(1);
      expect((await conn(id)).credentials_encrypted.toString("latin1")).not.toContain("at-1");
    });

    it("keeps a rotated refresh token: it is stored sealed and sent on the next refresh", async () => {
      const id = await connect(priya);
      const sent: string[] = [];
      const rotating = {
        id: "google",
        async refresh(refreshToken: string) {
          sent.push(refreshToken);
          return { accessToken: `rot-${sent.length}`, expiresAt: new Date(Date.now() + 3600_000), refreshToken: `rt-rotated-${sent.length}` };
        },
      } as unknown as CalendarProvider;
      const hoursLater = (h: number) => new Date(Date.now() + h * 3600_000);
      expect(await accessTokenFor(pool, { google: rotating }, key, id, hoursLater(2))).toBe("rot-1");
      const sealed = (await conn(id)).credentials_encrypted;
      expect(unseal<{ refreshToken: string }>(key, sealed, `google:${priya.id}:priya@gmail.com`).refreshToken).toBe("rt-rotated-1");
      expect(sealed.toString("latin1")).not.toContain("rt-rotated-1");
      expect(await accessTokenFor(pool, { google: rotating }, key, id, hoursLater(4))).toBe("rot-2");
      expect(sent).toEqual(["rt-for-tests", "rt-rotated-1"]);
    });

    it("two callers finding the token expired at once refresh it once and keep the rotated refresh token", async () => {
      const id = await connect(priya);
      const used = new Set<string>();
      let refreshes = 0;
      const rotating = {
        id: "google",
        // Like Microsoft: slow, rotates the refresh token, and refuses one that was already redeemed.
        async refresh(refreshToken: string) {
          if (used.has(refreshToken)) throw new CalendarApiError("invalid_grant: refresh token already redeemed", { retryable: false, revoked: true });
          used.add(refreshToken);
          refreshes++;
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { accessToken: `conc-${refreshes}`, expiresAt: new Date(Date.now() + 3 * 3600_000), refreshToken: `rt-conc-${refreshes}` };
        },
      } as unknown as CalendarProvider;
      const later = new Date(Date.now() + 2 * 3600_000);
      // What sync and the calendar jobs do with a revoked error: disconnect the connection.
      const call = () => accessTokenFor(pool, { google: rotating }, key, id, later)
        .catch(async (error) => { await recordConnectionFailure(pool, id, error, later); throw error; });
      const results = await Promise.allSettled([call(), call()]);
      expect(results).toEqual([{ status: "fulfilled", value: "conc-1" }, { status: "fulfilled", value: "conc-1" }]);
      expect(refreshes).toBe(1);
      const row = await conn(id);
      expect(unseal<{ refreshToken: string }>(key, row.credentials_encrypted, `google:${priya.id}:priya@gmail.com`).refreshToken).toBe("rt-conc-1");
      expect(row.status).toBe("ok");
    });

    it("another host can't change or remove a host's calendars", async () => {
      const { google } = fakeGoogle();
      const id = await connect(priya);
      const [primary] = await calendarRows(priya.id);
      expect(await setCheckConflicts(pool, arun.id, primary.id, false)).toBe(false);
      expect(await setAddToCalendar(pool, arun.id, primary.id)).toBe(false);
      expect(await disconnectConnection(pool, { google }, key, arun.id, id)).toBe(false);
      expect((await calendarRows(priya.id)).find((c) => c.id === primary.id).check_conflicts).toBe(true);
    });

    it("only a calendar the host owns can take bookings", async () => {
      await connect(priya);
      const team = (await calendarRows(priya.id)).find((c) => c.external_id.startsWith("team"));
      expect(await setAddToCalendar(pool, priya.id, team.id)).toBe(false);
    });

    it("a host can still disconnect when the server has no encryption key (the grant just isn't revoked)", async () => {
      const id = await connect(priya);
      expect(await disconnectConnection(pool, {}, null, priya.id, id)).toBe(true);
      expect(await store.listCalendarConnections(priya.id)).toEqual([]);
    });

    it("Google configured without a valid encryption key reads as not set up, and is reported as a configuration error", () => {
      const env = { HOURHAND_DATA: "postgres", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" };
      expect(calendarDeps(env)).toBeNull();
      expect(calendarConfigError(env)).toMatch(/TOKEN_ENCRYPTION_KEY/);
      expect(calendarConfigError({ ...env, TOKEN_ENCRYPTION_KEY: "short" })).toMatch(/32 bytes/);
      expect(calendarConfigError({ ...env, TOKEN_ENCRYPTION_KEY: "ab".repeat(32) })).toBeNull();
      expect(calendarDeps({ ...env, TOKEN_ENCRYPTION_KEY: "ab".repeat(32) })).not.toBeNull();
      expect(calendarConfigError({ HOURHAND_DATA: "postgres" })).toBeNull(); // Google not configured at all is fine
    });

    it("disconnecting revokes the grant and removes the calendars and busy times", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      s.busy.set("priya@gmail.com", [{ start: new Date(Date.now() + 3600_000), end: new Date(Date.now() + 7200_000) }]);
      await syncDueConnections(pool, { google }, key);
      expect(await disconnectConnection(pool, { google }, key, priya.id, id)).toBe(true);
      expect(s.revoked).toEqual(["rt-for-tests"]);
      expect(await calendarRows(priya.id)).toEqual([]);
      expect(await store.listBusyBlocks(priya.id, new Date(), new Date(Date.now() + 86_400_000))).toEqual([]);
    });
  });

  describe("syncing", () => {
    it("copies busy times from checked calendars and marks the connection in sync", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      const start = new Date(Date.now() + 26 * 3600_000);
      s.busy.set("priya@gmail.com", [{ start, end: new Date(start.getTime() + 3600_000) }]);
      s.busy.set("team@group.calendar.google.com", [{ start: new Date(start.getTime() + 7200_000), end: new Date(start.getTime() + 9000_000) }]);
      const [r] = await syncDueConnections(pool, { google }, key);
      expect(r).toMatchObject({ connectionId: id, ok: true });
      const blocks = await store.listBusyBlocks(priya.id, new Date(), new Date(Date.now() + 3 * 86_400_000));
      expect(blocks.map((b) => b.start.toISOString())).toEqual([start.toISOString()]); // the unchecked Team calendar is ignored
      expect((await conn(id)).last_synced_at).not.toBeNull();
      expect(await syncDueConnections(pool, { google }, key)).toEqual([]); // not due again for 5 minutes
    });

    it("turning a calendar off removes its busy times at the next sync", async () => {
      const { google, s } = fakeGoogle();
      await connect(priya);
      s.busy.set("priya@gmail.com", [{ start: new Date(Date.now() + 3600_000), end: new Date(Date.now() + 7200_000) }]);
      await syncDueConnections(pool, { google }, key);
      const [primary] = await calendarRows(priya.id);
      await setCheckConflicts(pool, priya.id, primary.id, false);
      await syncDueConnections(pool, { google }, key, new Date(Date.now() + 6 * MIN));
      expect(await store.listBusyBlocks(priya.id, new Date(), new Date(Date.now() + 86_400_000))).toEqual([]);
    });

    it("a calendar Google can't read fails the sync instead of counting as free, and keeps the last good busy times", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      const start = new Date(Date.now() + 5 * 3600_000);
      s.busy.set("priya@gmail.com", [{ start, end: new Date(start.getTime() + 3600_000) }]);
      await syncDueConnections(pool, { google }, key);
      s.freeBusyErrors.set("priya@gmail.com", "notFound");
      s.busy.delete("priya@gmail.com");
      const [r] = await syncDueConnections(pool, { google }, key, new Date(Date.now() + 6 * MIN));
      expect(r.ok).toBe(false);
      expect((await conn(id)).status).toBe("degraded");
      expect(await store.listBusyBlocks(priya.id, new Date(), new Date(Date.now() + 86_400_000))).toHaveLength(1);
    });

    it("passes the host's time zone to the provider and names every calendar it couldn't read", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      await pool.query("update users set timezone = 'Europe/London' where id = $1", [priya.id]);
      await pool.query("update calendars set check_conflicts = true where connection_id = $1", [id]);
      s.freeBusyErrors.set("priya@gmail.com", "notFound");
      s.freeBusyErrors.set("team@group.calendar.google.com", "forbidden");
      try {
        const [r] = await syncDueConnections(pool, { google }, key);
        expect(s.busyTimeZone).toBe("Europe/London");
        expect(r.ok).toBe(false);
        expect((await conn(id)).last_error).toMatch(/Priya \(notFound\).*Team \(forbidden\)/);
      } finally {
        await pool.query("update users set timezone = 'Asia/Kolkata' where id = $1", [priya.id]);
      }
    });

    it("a failing sync marks the connection degraded, emails the host once after repeated failures, and recovers", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      s.failFreeBusy = new GoogleApiError("Google 503", { status: 503, retryable: true });
      let now = new Date();
      for (let i = 1; i <= ALERT_AFTER_FAILURES + 1; i++) {
        await syncDueConnections(pool, { google }, key, now);
        now = new Date(now.getTime() + 3 * MIN);
      }
      const row = await conn(id);
      expect(row).toMatchObject({ status: "degraded", error_count: ALERT_AFTER_FAILURES + 1 });
      const alerts = await pool.query("select recipient from notifications where kind = 'calendar_alert_host' and status = 'queued'");
      expect(alerts.rows).toEqual([{ recipient: priya.email }]);

      s.failFreeBusy = null;
      await syncDueConnections(pool, { google }, key, now);
      expect(await conn(id)).toMatchObject({ status: "ok", error_count: 0, alert_sent_at: null });
    });

    it("a revoked grant disconnects at once, alerts the host, and stops syncing", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      s.failRefresh = new GoogleApiError("invalid_grant", { status: 400, reason: "invalid_grant", retryable: false, revoked: true });
      await syncDueConnections(pool, { google }, key, new Date(Date.now() + 2 * 3600_000)); // past the access token's expiry
      expect((await conn(id)).status).toBe("disconnected");
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, now: new Date(Date.now() + 2 * 3600_000) });
      expect(sent.map((m) => m.subject)).toEqual(["Reconnect your Google Calendar"]);
      expect(await syncDueConnections(pool, { google }, key, new Date(Date.now() + 3 * 3600_000))).toEqual([]);
    });

    it("a calendar switched on while a sync is running is synced again straight after, not 5 minutes later", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      s.duringFreeBusy = async () => { await pool.query("update calendar_connections set next_sync_at = now() where id = $1", [id]); };
      await syncDueConnections(pool, { google }, key);
      expect(await syncDueConnections(pool, { google }, key, new Date(Date.now() + 1000))).toHaveLength(1);
    });

    it("leaves demo connections without tokens alone", async () => {
      const { google } = fakeGoogle();
      await pool.query("insert into calendar_connections (user_id, provider, account_email, credentials_encrypted) values ($1, 'google', 'demo@example.in', '')", [priya.id]);
      expect(await syncDueConnections(pool, { google }, key)).toEqual([]);
    });
  });

  describe("writing bookings to the host's calendar", () => {
    it("creates the event with a Meet link, and the guest's confirmation waits for that link", async () => {
      const { google, s } = fakeGoogle();
      await connect(priya);
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      expect((await queue(b.id)).find((q) => q.kind === "calendar_create")).toMatchObject({ channel: "calendar", status: "queued" });
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key } });
      const event = s.events.get(eventIdFor(b.id))!;
      expect(event).toMatchObject({ calendarId: "priya@gmail.com", attendee: guest.email, withMeet: true });
      const after = (await store.getBooking(priya.id, b.id))!;
      expect(after.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
      // Whichever order the batch ran in, the confirmation is never sent without the link, and is due again at once
      // (the runner goes round again when a calendar write releases it).
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key } });
      const confirmations = sent.filter((m) => m.to === guest.email);
      expect(confirmations).toHaveLength(1);
      expect(confirmations[0].text).toContain(after.joinUrl!);
    });

    it("if the calendar write fails, the confirmation goes out without the link instead of waiting for a retry", async () => {
      const { google, s } = fakeGoogle();
      await connect(priya);
      s.failInsert = new GoogleApiError("Google 503", { status: 503, retryable: true });
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key } });
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key } });
      expect(sent.filter((m) => m.to === guest.email && m.subject.startsWith("Booked"))).toHaveLength(1);
      const q = await queue(b.id);
      expect(q.find((x) => x.kind === "booked_guest")!.status).toBe("sent");
      expect(q.find((x) => x.kind === "calendar_create")!.status).toBe("queued"); // still retrying in the background
    });

    it("a confirmation never waits longer than the Meet-link limit, even if the calendar write is never picked up", async () => {
      const { google } = fakeGoogle();
      await connect(priya);
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      // Hold the calendar write as if another worker had it.
      await pool.query("update notifications set locked_until = now() + interval '1 hour' where booking_id = $1 and channel = 'calendar'", [b.id]);
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key } });
      expect(sent.filter((m) => m.to === guest.email)).toHaveLength(0);
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key }, now: new Date(Date.now() + (MEET_LINK_WAIT_SECONDS + 5) * 1000) });
      expect(sent.filter((m) => m.to === guest.email && m.subject.startsWith("Booked"))).toHaveLength(1);
    });

    it("a reschedule moves the same event, and a cancellation removes it", async () => {
      const { google, s } = fakeGoogle();
      await connect(priya);
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      const deps = { baseUrl, calendar: { providers: { google }, key } };
      await processDueNotifications(pool, recordingMailer().mailer, deps);
      const newStart = nextStart();
      const moved = await store.rescheduleBooking(priya.id, b.id, newStart, `cal-move-${slot}`);
      await processDueNotifications(pool, recordingMailer().mailer, deps);
      expect(s.events.size).toBe(1);
      expect(s.events.get(eventIdFor(b.id))!.start.toISOString()).toBe(newStart.toISOString());
      expect((await store.getBooking(priya.id, moved.id))!.joinUrl).toMatch(/meet\.google\.com/);

      await store.cancelBooking(priya.id, moved.id, "guest");
      await processDueNotifications(pool, recordingMailer().mailer, deps);
      expect(s.events.size).toBe(0);
      expect((await queue(moved.id)).find((q) => q.kind === "calendar_delete")!.status).toBe("sent");
    });

    it("cancelling while the event is still being created waits for it, then removes it", async () => {
      const { google, s } = fakeGoogle();
      await connect(priya);
      let open!: () => void;
      s.insertGate = new Promise((r) => { open = r; });
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      const deps = { baseUrl, calendar: { providers: { google }, key } };
      const a = processDueNotifications(pool, recordingMailer().mailer, deps); // worker A is now inside Google's create call
      await new Promise((r) => setTimeout(r, 200));
      await store.cancelBooking(priya.id, b.id, "guest");
      await processDueNotifications(pool, recordingMailer().mailer, deps); // worker B sees the delete but must wait for A
      expect((await queue(b.id)).find((q) => q.kind === "calendar_delete")!.status).toBe("queued");
      s.insertGate = null;
      open();
      await a;
      expect(s.events.has(eventIdFor(b.id))).toBe(true);
      await processDueNotifications(pool, recordingMailer().mailer, { ...deps, now: new Date(Date.now() + 30_000) });
      expect(s.events.size).toBe(0);
    });

    it("rescheduling while the event is still being created moves that event instead of making a second one", async () => {
      const { google, s } = fakeGoogle();
      await connect(priya);
      let open!: () => void;
      s.insertGate = new Promise((r) => { open = r; });
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      const deps = { baseUrl, calendar: { providers: { google }, key } };
      const a = processDueNotifications(pool, recordingMailer().mailer, deps);
      await new Promise((r) => setTimeout(r, 200));
      const newStart = nextStart();
      await store.rescheduleBooking(priya.id, b.id, newStart, `cal-move-${slot}`);
      await processDueNotifications(pool, recordingMailer().mailer, deps);
      s.insertGate = null;
      open();
      await a;
      await processDueNotifications(pool, recordingMailer().mailer, { ...deps, now: new Date(Date.now() + 30_000) });
      expect(s.events.size).toBe(1);
      expect([...s.events.values()][0].start.toISOString()).toBe(newStart.toISOString());
    });

    it("a demo calendar without tokens never gets booked events queued", async () => {
      const { rows: [c] } = await pool.query(
        "insert into calendar_connections (user_id, provider, account_email, credentials_encrypted) values ($1, 'google', 'demo@example.in', '') returning id", [priya.id]);
      await pool.query("insert into calendars (connection_id, user_id, external_id, name, is_add_to) values ($1, $2, 'demo', 'Demo', true)", [c.id, priya.id]);
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      expect((await queue(b.id)).find((q) => q.kind === "calendar_create")).toBeUndefined();
    });

    it("a write that finds the grant revoked fails at once and disconnects the calendar", async () => {
      const { google, s } = fakeGoogle();
      const id = await connect(priya);
      s.failInsert = new GoogleApiError("insufficientPermissions", { status: 403, reason: "insufficientPermissions", retryable: false, revoked: true });
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      await processDueNotifications(pool, recordingMailer().mailer, { baseUrl, calendar: { providers: { google }, key } });
      expect((await queue(b.id)).find((q) => q.kind === "calendar_create")!.status).toBe("failed");
      expect((await conn(id)).status).toBe("disconnected");
    });

    it("without Google configured, calendar jobs are skipped and the confirmation isn't held up", async () => {
      await connect(priya);
      const b = await store.createBooking({ eventTypeId: coaching.id, startAt: nextStart(), idempotencyKey: `cal-${slot}`, invitee: guest });
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: null });
      await processDueNotifications(pool, mailer, { baseUrl, calendar: null, now: new Date(Date.now() + 30_000) });
      expect((await queue(b.id)).find((q) => q.kind === "calendar_create")).toMatchObject({ status: "skipped", last_error: "Google and Microsoft calendars are not configured on this server" });
      expect(sent.filter((m) => m.to === guest.email)).toHaveLength(1);
    });
  });

  describe("Teams links", () => {
    let teamsCall: EventType;
    const connectMs = (teams: boolean) => saveConnection(pool, key, priya.id, "microsoft", tokens("priya@contoso.com"),
      [{ id: "ms-cal", name: "Calendar", primary: true, accessRole: "owner", teams }], new Date());
    const canTeams = async (connectionId: string) =>
      (await pool.query("select can_teams from calendars where connection_id = $1", [connectionId])).rows.map((r) => r.can_teams);
    const book = () => store.createBooking({ eventTypeId: teamsCall.id, startAt: nextStart(), idempotencyKey: `teams-${slot}`, invitee: guest });
    // Hold the calendar write as if another worker had it, so the worker never polls the fake for a pending link.
    const holdCalendarJob = (bookingId: string) =>
      pool.query("update notifications set locked_until = now() + interval '1 hour' where booking_id = $1 and channel = 'calendar'", [bookingId]);
    const bookedMails = (sent: Mail[]) => sent.filter((m) => m.to === guest.email && m.subject.startsWith("Booked"));

    beforeAll(async () => {
      const { rows: [et] } = await pool.query(
        `insert into event_types (user_id, name, slug, duration_minutes, booking_window_days)
         select user_id, 'Teams call', 'teams-call', duration_minutes, booking_window_days from event_types where id = $1 returning id`, [coaching.id]);
      await pool.query("insert into event_locations (event_type_id, kind, value, position) values ($1, 'teams', null, 0)", [et.id]);
      teamsCall = (await store.listEventTypes(priya.id)).find((e) => e.id === et.id)!;
    });

    it("a Teams booking on a Microsoft calendar that allows Teams holds the confirmation until the link arrives, then sends it with the link", async () => {
      const { microsoft, s } = fakeMicrosoft();
      await connectMs(true);
      const b = await book();
      expect(b.locationKind).toBe("teams");
      await holdCalendarJob(b.id);
      const deps = { baseUrl, calendar: { providers: { microsoft }, key } };
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, deps);
      expect(bookedMails(sent)).toHaveLength(0);
      expect((await queue(b.id)).find((q) => q.kind === "booked_guest")).toMatchObject({ status: "queued", last_error: "waiting for the video link" });

      // The write runs and the link comes back on the first read after creation.
      await pool.query("update notifications set locked_until = null where booking_id = $1 and channel = 'calendar'", [b.id]);
      s.linkReady = true;
      await processDueNotifications(pool, mailer, deps);
      await processDueNotifications(pool, mailer, deps);
      const after = (await store.getBooking(priya.id, b.id))!;
      expect(after.joinUrl).toBe(`https://teams.microsoft.com/l/meetup-join/ms-${b.id}`);
      expect(s.events.get(`ms-${b.id}`)).toMatchObject({ calendarId: "ms-cal", withTeams: true });
      const confirmations = bookedMails(sent);
      expect(confirmations).toHaveLength(1);
      expect(confirmations[0].text).toContain(after.joinUrl!);
    });

    it("a Teams confirmation never waits longer than the video-link limit", async () => {
      const { microsoft } = fakeMicrosoft();
      await connectMs(true);
      const b = await book();
      await holdCalendarJob(b.id);
      const deps = { baseUrl, calendar: { providers: { microsoft }, key } };
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, deps);
      expect(bookedMails(sent)).toHaveLength(0);
      await processDueNotifications(pool, mailer, { ...deps, now: new Date(Date.now() + (MEET_LINK_WAIT_SECONDS + 5) * 1000) });
      expect(bookedMails(sent)).toHaveLength(1);
      expect((await queue(b.id)).find((q) => q.kind === "booked_guest")!.status).toBe("sent");
    });

    it("a Teams booking going into a Google calendar doesn't wait: Google can't make a Teams link", async () => {
      const { google } = fakeGoogle();
      await connect(priya);
      const b = await book();
      await holdCalendarJob(b.id);
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { google }, key } });
      expect(bookedMails(sent)).toHaveLength(1);
    });

    it("a Teams booking on a Microsoft calendar without Teams doesn't wait", async () => {
      const { microsoft } = fakeMicrosoft(false);
      await connectMs(false);
      const b = await book();
      await holdCalendarJob(b.id);
      const { mailer, sent } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { microsoft }, key } });
      expect(bookedMails(sent)).toHaveLength(1);
    });

    it.each([[false, null], [true, "teams"]] as const)("a Teams booking's event asks for a Teams meeting only where the calendar allows it (can_teams %s)", async (teams, conference) => {
      const { microsoft, s } = fakeMicrosoft(teams);
      s.linkReady = true;
      const asked: (string | null)[] = [];
      const insert = microsoft.insertEvent.bind(microsoft);
      microsoft.insertEvent = (token, calendarId, e) => { asked.push(e.conference); return insert(token, calendarId, e); };
      await connectMs(teams);
      const b = await book();
      const { mailer } = recordingMailer();
      await processDueNotifications(pool, mailer, { baseUrl, calendar: { providers: { microsoft }, key } });
      expect(asked).toEqual([conference]);
      expect((await queue(b.id)).find((q) => q.kind === "calendar_create")!.status).toBe("sent");
    });

    it("stores whether each calendar can make Teams meetings, and a reconnect updates it", async () => {
      const { microsoft } = fakeMicrosoft(true);
      const listed = await microsoft.listCalendars("at-0");
      const id = await saveConnection(pool, key, priya.id, "microsoft", tokens("priya@contoso.com"), listed, new Date());
      expect(await canTeams(id)).toEqual([true]);
      const again = await saveConnection(pool, key, priya.id, "microsoft", tokens("priya@contoso.com"), await fakeMicrosoft(false).microsoft.listCalendars("at-0"), new Date());
      expect(again).toBe(id);
      expect(await canTeams(id)).toEqual([false]);
      const back = await connectMs(true);
      expect(await canTeams(back)).toEqual([true]);
      const googleId = await connect(priya);
      expect(await canTeams(googleId)).toEqual([null, null]);
    });

    it("Free's limit of 2 checked calendars counts Google and Microsoft calendars together", async () => {
      await pool.query("delete from subscriptions where user_id = $1", [priya.id]);
      expect(await hostPlan(pool, priya.id)).toBe("free");
      await connect(priya);
      await connectMs(true);
      const rows = (await pool.query("select id, external_id, check_conflicts from calendars where user_id = $1", [priya.id])).rows;
      expect(rows.filter((r) => r.check_conflicts).map((r) => r.external_id).sort()).toEqual(["ms-cal", "priya@gmail.com"]);
      const team = rows.find((r) => r.external_id.startsWith("team"));
      expect(await setCheckConflicts(pool, priya.id, team.id, true)).toBe(false);
    });
  });
});
