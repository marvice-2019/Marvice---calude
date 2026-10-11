// Inserts the demo data from src/lib/data/seed.ts (Priya) plus a second host (Arun) used by the isolation tests.
// Fictional people only. Safe to re-run: a host whose slug already exists is skipped. Usage: DATABASE_URL=... npm run db:seed
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildSeed, type Seed } from "../src/lib/data/seed.ts";

const MIN = 60_000;

/** Arun Iyer: one event type, one confirmed booking, his own schedule. Ids are mapped to uuids on insert. */
function arunSeed(now: Date): Seed {
  const userId = "usr_arun";
  const start = new Date(Math.ceil((now.getTime() + 3 * 24 * 60 * MIN) / (60 * MIN)) * 60 * MIN);
  const end = new Date(start.getTime() + 30 * MIN);
  return {
    users: [{ id: userId, email: "arun@example.in", name: "Arun Iyer", slug: "arun", timezone: "Asia/Kolkata", timeFormat: "24h" }],
    schedules: [{ id: "sch_arun", userId, name: "Working hours", timezone: "Asia/Kolkata", isDefault: true }],
    rules: [1, 2, 3, 4, 5].map((d) => ({ id: `rule_a${d}`, scheduleId: "sch_arun", kind: "weekly" as const, weekday: d, onDate: null, intervals: [{ from: "09:00", to: "17:00" }] })),
    eventTypes: [{
      id: "evt_arun_chat", userId, scheduleId: "sch_arun", name: "30-min chat", slug: "chat", description: null, durationMinutes: 30, minNoticeMinutes: 60,
      bookingWindowDays: 30, startIncrementMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dailyLimit: null, cancelCutoffMinutes: 0, hidden: false, active: true, position: 0,
    }],
    locations: [], questions: [], connections: [], calendars: [], busyBlocks: [],
    bookings: [{
      id: "bkg_arun_1", eventTypeId: "evt_arun_chat", hostId: userId, startAt: start, endAt: end, bufferedStart: start, bufferedEnd: end, status: "confirmed",
      locationKind: null, idempotencyKey: "seed-bkg_arun_1", cancelledAt: null, cancelledBy: null, cancelReason: null, rescheduledFromId: null, createdAt: now,
      invitee: { id: "inv_arun_1", bookingId: "bkg_arun_1", hostId: userId, name: "Divya Menon", email: "divya.menon@example.com", timezone: "Asia/Kolkata", phone: null, answers: [], manageToken: "tok_bkg_arun_1" },
    }],
  };
}

async function insertSeed(client: pg.Client, s: Seed): Promise<boolean> {
  const exists = await client.query("select 1 from users where slug = $1", [s.users[0].slug]);
  if (exists.rowCount) return false;
  const ids = new Map<string, string>();
  const id = (key: string) => {
    if (!ids.has(key)) ids.set(key, randomUUID());
    return ids.get(key)!;
  };
  const q = (sql: string, values: unknown[]) => client.query(sql, values);

  for (const u of s.users) await q("insert into users (id, email, name, slug, timezone, time_format) values ($1,$2,$3,$4,$5,$6)", [id(u.id), u.email, u.name, u.slug, u.timezone, u.timeFormat]);
  for (const sc of s.schedules) await q("insert into availability_schedules (id, user_id, name, timezone, is_default) values ($1,$2,$3,$4,$5)", [id(sc.id), id(sc.userId), sc.name, sc.timezone, sc.isDefault]);
  for (const r of s.rules) await q("insert into availability_rules (id, schedule_id, kind, weekday, on_date, intervals) values ($1,$2,$3,$4,$5,$6)", [id(r.id), id(r.scheduleId), r.kind, r.weekday, r.onDate, JSON.stringify(r.intervals)]);
  for (const e of s.eventTypes) {
    await q(
      `insert into event_types (id, user_id, schedule_id, name, slug, description, duration_minutes, min_notice_minutes, booking_window_days, start_increment_minutes,
        buffer_before_minutes, buffer_after_minutes, daily_limit, cancel_cutoff_minutes, hidden, active, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id(e.id), id(e.userId), e.scheduleId && id(e.scheduleId), e.name, e.slug, e.description, e.durationMinutes, e.minNoticeMinutes, e.bookingWindowDays, e.startIncrementMinutes,
        e.bufferBeforeMinutes, e.bufferAfterMinutes, e.dailyLimit, e.cancelCutoffMinutes, e.hidden, e.active, e.position],
    );
  }
  for (const l of s.locations) await q("insert into event_locations (id, event_type_id, kind, value, position) values ($1,$2,$3,$4,$5)", [id(l.id), id(l.eventTypeId), l.kind, l.value, l.position]);
  for (const c of s.questions) await q("insert into custom_questions (id, event_type_id, label, kind, required, choices, position) values ($1,$2,$3,$4,$5,$6,$7)", [id(c.id), id(c.eventTypeId), c.label, c.kind, c.required, c.choices, c.position]);
  for (const c of s.connections) {
    // No real credentials exist for demo data; the column is not null, so store an empty placeholder.
    await q("insert into calendar_connections (id, user_id, provider, account_email, credentials_encrypted, status, last_synced_at, last_error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id(c.id), id(c.userId), c.provider, c.accountEmail, Buffer.alloc(0), c.status, c.lastSyncedAt, c.lastError]);
  }
  for (const c of s.calendars) await q("insert into calendars (id, connection_id, user_id, external_id, name, check_conflicts, is_add_to) values ($1,$2,$3,$4,$5,$6,$7)", [id(c.id), id(c.connectionId), id(c.userId), c.id, c.name, c.checkConflicts, c.isAddTo]);
  for (const b of s.busyBlocks) await q("insert into busy_blocks (id, calendar_id, user_id, external_event_id, busy) values ($1,$2,$3,$4,tstzrange($5,$6,'[)'))", [id(b.id), id(b.calendarId), id(b.userId), b.id, b.start, b.end]);
  for (const b of s.bookings) {
    await q(
      `insert into bookings (id, event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, location_kind, idempotency_key,
        cancelled_at, cancelled_by, cancel_reason, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id(b.id), id(b.eventTypeId), id(b.hostId), b.startAt, b.endAt, b.bufferedStart, b.bufferedEnd, b.status, b.locationKind, b.idempotencyKey, b.cancelledAt, b.cancelledBy, b.cancelReason, b.createdAt],
    );
    const i = b.invitee;
    await q("insert into invitees (id, booking_id, host_id, name, email, timezone, phone, answers, manage_token) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id(i.id), id(b.id), id(b.hostId), i.name, i.email, i.timezone, i.phone, JSON.stringify(i.answers), i.manageToken]);
  }
  return true;
}

/** Seeds Priya and Arun in one transaction. Returns the slugs it inserted. */
export async function seed(databaseUrl: string, now = new Date()): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    const inserted: string[] = [];
    for (const s of [buildSeed(now), arunSeed(now)]) if (await insertSeed(client, s)) inserted.push(s.users[0].slug);
    await client.query("commit");
    return inserted;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const inserted = await seed(url);
  console.log(inserted.length ? `Seeded ${inserted.join(", ")}` : "Already seeded");
}
