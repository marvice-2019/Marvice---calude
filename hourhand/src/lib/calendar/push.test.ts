// Instant sync (Google watch channels) against real Postgres with a fake Google. Runs only with TEST_DATABASE_URL; uses
// its own database (<name>_push), dropped and recreated on every run.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "../data/pg-store";
import type { User } from "../data/types";
import { disconnectConnection, saveGoogleConnection } from "./connections";
import { GoogleApiError, GOOGLE_CALENDAR_SCOPES, REQUIRED_SCOPES, type GoogleClient } from "./google";
import { handlePing, maintainChannels, pushAddress } from "./push";

const BASE = process.env.TEST_DATABASE_URL;
const ADDRESS = "https://hourhand.test/api/webhooks/google-calendar";

describe("push address and scopes", () => {
  it("only a public https URL gets pings; the e2e switch allows the fake Google's http address", () => {
    expect(pushAddress("https://hourhand.in")).toBe("https://hourhand.in/api/webhooks/google-calendar");
    expect(pushAddress("http://localhost:3000", {})).toBeNull();
    expect(pushAddress("http://localhost:3000", { HOURHAND_E2E: "1" })).toBe("http://localhost:3000/api/webhooks/google-calendar");
  });

  it("asks for availability on every calendar (which can be watched), never the narrower scope that can't", () => {
    expect(REQUIRED_SCOPES).toContain("https://www.googleapis.com/auth/calendar.events.freebusy");
    expect(GOOGLE_CALENDAR_SCOPES).not.toContain("https://www.googleapis.com/auth/calendar.freebusy");
  });
});

/** Just the watch side of Google: who is watched, what was stopped, and a switch to refuse watches. */
function fakeGoogle() {
  const s = { watches: [] as { calendarId: string; id: string; token: string; address: string }[], stopped: [] as string[], refuse: null as GoogleApiError | null };
  const g = {
    async refresh() { return { accessToken: "at-r", expiresAt: new Date(Date.now() + 3600_000) }; },
    async revoke() {},
    async watchEvents(_t: string, calendarId: string, ch: { id: string; token: string; address: string }) {
      if (s.refuse) throw s.refuse;
      s.watches.push({ calendarId, ...ch });
      return { resourceId: `res-${calendarId}`, expiresAt: new Date(Date.now() + 7 * 86_400_000) };
    },
    async stopChannel(_t: string, id: string) { s.stopped.push(id); },
  };
  return { s, google: g as unknown as GoogleClient };
}

describe.skipIf(!BASE)("instant sync (TEST_DATABASE_URL)", () => {
  let pool: pg.Pool;
  let priya: User;
  const key = randomBytes(32);
  const cals = [
    { id: "priya@gmail.com", name: "Priya", primary: true, accessRole: "owner" },
    { id: "team@group.calendar.google.com", name: "Team", primary: false, accessRole: "reader" },
  ];
  const connect = () => saveGoogleConnection(pool, key, priya.id,
    { accessToken: "at-0", refreshToken: "rt", expiresAt: new Date(Date.now() + 3600_000), scope: REQUIRED_SCOPES.join(" "), email: "priya@gmail.com" }, cals, new Date());
  const calRow = async (externalId: string) => (await pool.query("select * from calendars where external_id = $1 and user_id = $2", [externalId, priya.id])).rows[0];

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_push`;
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
    priya = (await createPgStore(pool).getUserBySlug("priya"))!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("delete from calendar_connections");
  });

  it("watches each checked calendar once, with its own secret token, and leaves unchecked ones alone", async () => {
    await connect();
    const { s, google } = fakeGoogle();
    expect(await maintainChannels(pool, google, key, ADDRESS)).toMatchObject({ started: 1, failed: 0 });
    expect(s.watches.map((w) => w.calendarId)).toEqual(["priya@gmail.com"]); // the team calendar isn't checked by default
    const row = await calRow("priya@gmail.com");
    expect(row).toMatchObject({ push_channel_id: s.watches[0].id, push_resource_id: "res-priya@gmail.com", push_token: s.watches[0].token, push_error: null });
    expect(s.watches[0].address).toBe(ADDRESS);
    expect(await maintainChannels(pool, google, key, ADDRESS)).toMatchObject({ started: 0 }); // not due again for days
  });

  it("renews a channel a day before it ends and stops the old one", async () => {
    await connect();
    const { s, google } = fakeGoogle();
    await maintainChannels(pool, google, key, ADDRESS);
    const first = s.watches[0].id;
    await pool.query("update calendars set push_expires_at = now() + interval '12 hours' where push_channel_id = $1", [first]);
    expect(await maintainChannels(pool, google, key, ADDRESS)).toMatchObject({ started: 1 });
    expect((await calRow("priya@gmail.com")).push_channel_id).not.toBe(first);
    expect(s.stopped).toEqual([first]);
  });

  it("stops the channel when the host stops checking that calendar", async () => {
    await connect();
    const { s, google } = fakeGoogle();
    await maintainChannels(pool, google, key, ADDRESS);
    await pool.query("update calendars set check_conflicts = false where external_id = 'priya@gmail.com'");
    expect(await maintainChannels(pool, google, key, ADDRESS)).toMatchObject({ stopped: 1, started: 0 });
    expect(s.stopped).toEqual([s.watches[0].id]);
    expect((await calRow("priya@gmail.com")).push_channel_id).toBeNull();
  });

  it("a calendar Google won't watch is noted and retried later, and its connection keeps syncing", async () => {
    const id = await connect();
    const { s, google } = fakeGoogle();
    s.refuse = new GoogleApiError("Google POST watch 400 pushNotSupportedForRequestedResource", { status: 400, reason: "pushNotSupportedForRequestedResource", retryable: false });
    expect(await maintainChannels(pool, google, key, ADDRESS)).toMatchObject({ failed: 1 });
    const row = await calRow("priya@gmail.com");
    expect(row.push_error).toContain("pushNotSupported");
    expect(new Date(row.push_retry_at).getTime()).toBeGreaterThan(Date.now() + 20 * 3600_000);
    expect((await pool.query("select status from calendar_connections where id = $1", [id])).rows[0].status).toBe("ok");
    s.refuse = null;
    expect(await maintainChannels(pool, google, key, ADDRESS)).toMatchObject({ started: 0 }); // not before the retry time
  });

  it("a ping with the right channel and token brings the next sync forward; anything else changes nothing", async () => {
    const id = await connect();
    const { s, google } = fakeGoogle();
    await maintainChannels(pool, google, key, ADDRESS);
    const later = new Date(Date.now() + 5 * 60_000);
    const setNext = () => pool.query("update calendar_connections set next_sync_at = $2 where id = $1", [id, later]);
    const next = async () => new Date((await pool.query("select next_sync_at from calendar_connections where id = $1", [id])).rows[0].next_sync_at).getTime();
    const ch = s.watches[0];
    await setNext();
    expect(await handlePing(pool, { channelId: ch.id, token: "f".repeat(48), state: "exists" })).toBe("ignored");
    expect(await handlePing(pool, { channelId: "not-a-channel", token: ch.token, state: "exists" })).toBe("ignored");
    expect(await handlePing(pool, { channelId: ch.id, token: ch.token, state: "sync" })).toBe("ignored");
    expect(await handlePing(pool, { channelId: ch.id, token: null, state: "exists" })).toBe("ignored");
    expect(await next()).toBe(later.getTime());
    const now = new Date();
    expect(await handlePing(pool, { channelId: ch.id, token: ch.token, state: "exists" }, now)).toBe("synced");
    expect(await next()).toBe(now.getTime());
  });

  it("disconnecting stops the connection's channels before the grant is revoked", async () => {
    const id = await connect();
    const { s, google } = fakeGoogle();
    await maintainChannels(pool, google, key, ADDRESS);
    await disconnectConnection(pool, google, key, priya.id, id);
    expect(s.stopped).toEqual([s.watches[0].id]);
  });
});
