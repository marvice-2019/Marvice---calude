// Connecting iCloud with an app-specific password, against real Postgres (only with TEST_DATABASE_URL; own database <name>_icx).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { accessTokenFor, connectICloud, disconnectConnection } from "./connections";
import { icloudClient } from "./icloud";
import { CalendarApiError, type CalendarEntry } from "./provider";

const BASE = process.env.TEST_DATABASE_URL;
const PASSWORD = "abcd-efgh-ijkl-mnop";
const calendars: CalendarEntry[] = [{ id: "https://p01-caldav.icloud.com/123/calendars/work/", name: "Work", primary: true, accessRole: "owner" }];

describe.skipIf(!BASE)("iCloud connect (Postgres)", () => {
  let pool: pg.Pool;
  let priya: string;
  const key = randomBytes(32);
  const now = new Date("2026-10-11T06:00:00Z");

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_icx`;
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
    priya = (await pool.query("select id from users where slug = 'priya'")).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  const count = async () => (await pool.query("select count(*)::int as n from calendar_connections where provider = 'icloud'")).rows[0].n;

  it("stores nothing when Apple refuses the password, or can't be reached", async () => {
    const refusing = { listCalendars: async () => { throw new CalendarApiError("401", { status: 401, revoked: true }); } };
    expect(await connectICloud(pool, key, refusing, priya, "priya@icloud.com", "wrong-wrong-wrong", now)).toBe("rejected");
    const down = { listCalendars: async () => { throw new CalendarApiError("503", { status: 503, retryable: true }); } };
    expect(await connectICloud(pool, key, down, priya, "priya@icloud.com", PASSWORD, now)).toBe("unreachable");
    expect(await count()).toBe(0);
  });

  it("stores the connection and its calendars with the password sealed, and hands the provider the credential", async () => {
    const seen: string[] = [];
    const apple = { listCalendars: async (credential: string) => { seen.push(credential); return calendars; } };
    expect(await connectICloud(pool, key, apple, priya, " Priya@iCloud.com ", PASSWORD, now)).toBe("ok");
    expect(seen).toEqual([`priya@icloud.com:${PASSWORD}`]);
    const { rows: [row] } = await pool.query("select * from calendar_connections where provider = 'icloud'");
    expect(row.account_email).toBe("priya@icloud.com");
    // No column, in any encoding we'd write, holds the password readable.
    const dump = JSON.stringify(row, (_k, v) => (Buffer.isBuffer(v) ? v.toString("latin1") + v.toString("hex") + v.toString("base64") : v));
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(Buffer.from(PASSWORD).toString("hex"));
    expect((await pool.query("select name from calendars where connection_id = $1", [row.id])).rows).toEqual([{ name: "Work" }]);
    expect(await accessTokenFor(pool, { icloud: apple as never }, key, row.id, now)).toBe(`priya@icloud.com:${PASSWORD}`);
  });

  it("disconnects without calling Apple (there's nothing to revoke)", async () => {
    let calls = 0;
    const client = icloudClient({ baseUrl: "https://caldav.icloud.com", fetchImpl: (async () => { calls++; return new Response("", { status: 500 }); }) as typeof fetch });
    const { rows: [row] } = await pool.query("select id from calendar_connections where provider = 'icloud'");
    expect(await disconnectConnection(pool, { icloud: client as never }, key, priya, row.id)).toBe(true);
    expect(calls).toBe(0);
    expect(await count()).toBe(0);
  });
});
