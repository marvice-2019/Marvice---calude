// The email queue against real Postgres. Runs only with TEST_DATABASE_URL; uses its own database (<name>_jobs) so it
// can run beside the store's tests, and drops and recreates it on every run.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "../data/pg-store";
import type { DataStore, EventType, User } from "../data/types";
import { MailError, type Mail, type Mailer } from "../mail/mailer";
import { MAX_ATTEMPTS, processDueNotifications } from "./worker";

const BASE = process.env.TEST_DATABASE_URL;
const MIN = 60_000;
const guest = { name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: null, answers: [] };
const baseUrl = "https://hourhand.test";

/** A mailer that records what it sends, or fails the way it is told to. */
function fakeMailer(fail?: (mail: Mail) => Error | null) {
  const sent: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      const error = fail?.(mail);
      if (error) throw error;
      sent.push(mail);
      return { id: `fake-${sent.length}` };
    },
  };
  return { mailer, sent };
}

describe.skipIf(!BASE)("email queue (TEST_DATABASE_URL)", () => {
  let url: string;
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let coaching: EventType;
  let slot = 0;
  /** A fresh slot far in the future for each booking. */
  const nextStart = () => new Date(Date.UTC(2031, 0, 6 + slot++, 4, 0));

  const rows = async (bookingId: string) =>
    (await pool.query("select kind, recipient, status, attempts, send_at, last_error, provider_message_id from notifications where booking_id = $1 order by kind, send_at", [bookingId])).rows;
  const book = (startAt = nextStart(), key = `jobs-${slot}-${Math.random()}`) =>
    store.createBooking({ eventTypeId: coaching.id, startAt, idempotencyKey: key, invitee: guest });

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_jobs`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    url = u.toString();
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const client = new pg.Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      await client.query(`drop database if exists ${name} with (force)`);
      await client.query(`create database ${name}`);
    } finally {
      await client.end();
    }
    await migrate(url);
    await seed(url);
    pool = new pg.Pool({ connectionString: url });
    store = createPgStore(pool);
    priya = (await store.getUserBySlug("priya"))!;
    coaching = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  // Each test starts with an empty queue, so what a run sends is what that test queued.
  beforeEach(async () => {
    await pool.query("update notifications set status = 'skipped' where status = 'queued'");
  });

  it("a booking queues the guest's confirmation, the host's notice and two reminders in the same transaction", async () => {
    const b = await book();
    const r = await rows(b.id);
    expect(r.map((x) => x.kind).sort()).toEqual(["booked_guest", "booked_host", "reminder_guest", "reminder_guest"]);
    expect(r.find((x) => x.kind === "booked_host")!.recipient).toBe(priya.email);
    const reminders = r.filter((x) => x.kind === "reminder_guest").map((x) => b.startAt.getTime() - new Date(x.send_at).getTime());
    expect(reminders.sort((a, z) => a - z)).toEqual([60 * MIN, 1440 * MIN]);
  });

  it("a booking made 90 minutes ahead gets only the one-hour reminder", async () => {
    const start = new Date(Math.ceil((Date.now() + 90 * MIN) / (15 * MIN)) * 15 * MIN);
    const b = await book(start);
    expect((await rows(b.id)).filter((x) => x.kind === "reminder_guest")).toHaveLength(1);
  });

  it("sends what is due now, once, with the notification id as Resend's idempotency key", async () => {
    const b = await book();
    const { mailer, sent } = fakeMailer();
    const first = await processDueNotifications(pool, mailer, { baseUrl });
    expect(first.sent).toBe(2);
    expect(sent.map((m) => m.to).sort()).toEqual([guest.email, priya.email].sort());
    expect(sent.every((m) => /^notification-[0-9a-f-]{36}$/.test(m.idempotencyKey))).toBe(true);
    expect(sent.find((m) => m.to === guest.email)!.text).toContain(`${baseUrl}/b/${b.invitee.manageToken}`);
    const again = await processDueNotifications(pool, mailer, { baseUrl });
    expect(again.claimed).toBe(0);
    const r = await rows(b.id);
    expect(r.filter((x) => x.status === "sent").map((x) => x.provider_message_id).every(Boolean)).toBe(true);
    expect(r.filter((x) => x.kind === "reminder_guest").every((x) => x.status === "queued")).toBe(true);
  });

  it("sends a reminder when it falls due", async () => {
    const b = await book();
    await processDueNotifications(pool, fakeMailer().mailer, { baseUrl });
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl, now: new Date(b.startAt.getTime() - 59 * MIN) });
    expect(sent.map((m) => m.subject)).toHaveLength(2); // both reminders are due by then; the 24-hour one was simply late
    expect(sent.every((m) => m.subject.startsWith("Reminder:"))).toBe(true);
  });

  it("retries a temporary failure later, and gives up after the last attempt into the dead-letter state", async () => {
    const b = await book();
    const down = fakeMailer(() => new MailError("Resend 503", true, 503));
    let now = new Date();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await processDueNotifications(pool, down.mailer, { baseUrl, now });
      const guestRow = (await rows(b.id)).find((x) => x.kind === "booked_guest")!;
      expect(guestRow.attempts).toBe(attempt);
      if (attempt < MAX_ATTEMPTS) {
        expect(guestRow.status).toBe("queued");
        expect(new Date(guestRow.send_at).getTime()).toBeGreaterThan(now.getTime());
        now = new Date(new Date(guestRow.send_at).getTime() + 1000);
      } else {
        expect(guestRow.status).toBe("failed");
        expect(guestRow.last_error).toContain("503");
      }
    }
  });

  it("fails a permanent error at once, without retrying", async () => {
    const b = await book();
    const rejecting = fakeMailer((m) => (m.to === guest.email ? new MailError("Resend 422 validation_error", false, 422) : null));
    const r = await processDueNotifications(pool, rejecting.mailer, { baseUrl });
    expect(r).toMatchObject({ sent: 1, failed: 1, retrying: 0 });
    expect((await rows(b.id)).find((x) => x.kind === "booked_guest")!.status).toBe("failed");
  });

  it("cancelling queues both cancellation emails and stops the reminders", async () => {
    const b = await book();
    await store.cancelBooking(priya.id, b.id, "guest", "Travelling");
    const r = await rows(b.id);
    expect(r.filter((x) => x.kind.startsWith("cancelled_")).map((x) => x.kind).sort()).toEqual(["cancelled_guest", "cancelled_host"]);
    expect(r.filter((x) => x.kind === "reminder_guest").every((x) => x.status === "skipped")).toBe(true);
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl });
    expect(sent.find((m) => m.to === guest.email && m.subject.startsWith("Cancelled"))!.text).toContain("Travelling");
  });

  it("a reminder already claimed for a booking that was cancelled is skipped at send time", async () => {
    const b = await book();
    // Simulate a cancellation that bypassed the queue update: the reminder stays queued.
    await pool.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'host' where id = $1", [b.id]);
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl, now: new Date(b.startAt.getTime() - 30 * MIN) });
    expect(sent.filter((m) => m.subject.startsWith("Reminder"))).toHaveLength(0);
    expect((await rows(b.id)).filter((x) => x.kind === "reminder_guest").every((x) => x.status === "skipped" && x.last_error === "booking cancelled")).toBe(true);
  });

  it("rescheduling sends 'moved' emails for the new time and stops the old booking's reminders", async () => {
    const b = await book();
    const moved = await store.rescheduleBooking(priya.id, b.id, nextStart(), `jobs-move-${b.id}`);
    expect((await rows(b.id)).filter((x) => x.kind === "reminder_guest").every((x) => x.status === "skipped")).toBe(true);
    expect((await rows(moved.id)).map((x) => x.kind).sort()).toEqual(["reminder_guest", "reminder_guest", "rescheduled_guest", "rescheduled_host"]);
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl });
    expect(sent.find((m) => m.to === guest.email && m.subject.startsWith("Moved"))!.text).toContain("Was:");
  });

  it("closing an account emails each affected guest, and not the host", async () => {
    const { rows: [host] } = await pool.query(
      "insert into users (email, name, slug) values ('closing-jobs@example.com', 'Dev Rao', 'closing-jobs') returning id");
    const { rows: [et] } = await pool.query(
      "insert into event_types (user_id, name, slug, duration_minutes) values ($1, 'Chat', 'chat', 30) returning id", [host.id]);
    const b = await store.createBooking({ eventTypeId: et.id, startAt: nextStart(), idempotencyKey: `jobs-close-${Date.now()}`, invitee: guest });
    await pool.query("update notifications set status = 'skipped' where booking_id = $1", [b.id]);
    await store.deleteAccount(host.id);
    const r = (await rows(b.id)).filter((x) => x.status === "queued");
    expect(r.map((x) => x.kind)).toEqual(["cancelled_guest"]);
  });

  it("a confirmation still waiting to retry is not sent once the guest has cancelled", async () => {
    const b = await book();
    await processDueNotifications(pool, fakeMailer(() => new MailError("Resend 503", true, 503)).mailer, { baseUrl });
    await store.cancelBooking(priya.id, b.id, "guest");
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl, now: new Date(Date.now() + 10 * MIN) });
    expect(sent.map((m) => m.subject).filter((s) => !s.startsWith("Cancelled"))).toEqual([]);
    expect((await rows(b.id)).find((x) => x.kind === "booked_guest")!.status).toBe("skipped");
  });

  it("a confirmation for a booking cancelled behind the queue's back is skipped at send time", async () => {
    const b = await book();
    await pool.query("update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'host' where id = $1", [b.id]);
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl });
    expect(sent).toHaveLength(0);
    expect((await rows(b.id)).filter((x) => x.kind.startsWith("booked_")).every((x) => x.status === "skipped")).toBe(true);
  });

  it("moving a booking stops the old time's queued confirmation", async () => {
    const b = await book();
    await processDueNotifications(pool, fakeMailer(() => new MailError("Resend 503", true, 503)).mailer, { baseUrl });
    await store.rescheduleBooking(priya.id, b.id, nextStart(), `jobs-move2-${b.id}`);
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl, now: new Date(Date.now() + 10 * MIN) });
    expect(sent.filter((m) => m.subject.startsWith("Booked"))).toHaveLength(0);
    expect(sent.filter((m) => m.subject.startsWith("Moved"))).toHaveLength(2);
  });

  it("a row another worker took over in the middle of a batch is left to that worker", async () => {
    await book();
    let first = true;
    const { mailer, sent } = fakeMailer();
    const stealing: Mailer = {
      async send(m) {
        if (first) {
          first = false;
          // While this worker sends its first email, another worker takes over every other row it holds.
          await pool.query("update notifications set locked_until = locked_until + interval '1 second' where status = 'queued' and locked_until is not null");
        }
        return mailer.send(m);
      },
    };
    const r = await processDueNotifications(pool, stealing, { baseUrl });
    expect(r.claimed).toBe(2);
    expect(sent).toHaveLength(1);
    expect(r.sent).toBe(1);
  });

  it("two workers running at once send each email exactly once", async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await book()).id);
    const { mailer, sent } = fakeMailer();
    const slow: Mailer = { send: async (m) => { await new Promise((r) => setTimeout(r, 5)); return mailer.send(m); } };
    await Promise.all([processDueNotifications(pool, slow, { baseUrl, limit: 4 }), processDueNotifications(pool, slow, { baseUrl, limit: 4 }),
      processDueNotifications(pool, slow, { baseUrl, limit: 4 })]);
    await processDueNotifications(pool, slow, { baseUrl });
    expect(sent).toHaveLength(12);
    expect(new Set(sent.map((m) => m.idempotencyKey)).size).toBe(12);
  });

  it("a row held by a worker that died is picked up again after its lease runs out", async () => {
    const b = await book();
    await pool.query("update notifications set locked_until = now() + interval '5 minutes', attempts = 1 where booking_id = $1 and kind = 'booked_guest'", [b.id]);
    const { mailer, sent } = fakeMailer();
    await processDueNotifications(pool, mailer, { baseUrl });
    expect(sent.filter((m) => m.to === guest.email)).toHaveLength(0);
    await processDueNotifications(pool, mailer, { baseUrl, now: new Date(Date.now() + 6 * MIN) });
    expect(sent.filter((m) => m.to === guest.email)).toHaveLength(1);
    expect((await rows(b.id)).find((x) => x.kind === "booked_guest")!.attempts).toBe(2);
  });
});
