// The Duo plan's second person, against real Postgres (only with TEST_DATABASE_URL; uses its own database <name>_seat).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { hostPlan } from "./billing/account";
import { processDueNotifications } from "./jobs/worker";
import type { Mail } from "./mail/mailer";
import { acceptSeat, canActFor, inviteSeat, leaveSeat, ownPlan, pendingInvite, removeSeat, seatFor, seatOwner } from "./seats";

const BASE = process.env.TEST_DATABASE_URL;

describe.skipIf(!BASE)("Duo seat (Postgres)", () => {
  let pool: pg.Pool;
  type Person = { id: string; email: string };
  let owner: Person, member: Person, other: Person, stranger: Person;
  const now = new Date("2026-10-11T06:00:00Z");
  const plan = (u: Person, p: string, status = "active") =>
    pool.query("insert into subscriptions (user_id, plan, status) values ($1, $2, $3) on conflict (user_id) do update set plan = $2, status = $3", [u.id, p, status]);

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_seat`;
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
    pool = new pg.Pool({ connectionString: u.toString() });
    const user = async (email: string, nm: string, slug: string) => (await pool.query("insert into users (email, name, slug) values ($1, $2, $3) returning id, email", [email, nm, slug])).rows[0] as Person;
    owner = await user("owner@example.com", "Owner Priya", "owner-p");
    member = await user("Asst@Example.com", "Assistant Ravi", "asst-r");
    other = await user("other@example.com", "Other Owner", "other-o");
    stranger = await user("stranger@example.com", "Stranger", "stranger-s");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("needs the owner on Duo, and someone else's email", async () => {
    await expect(inviteSeat(pool, owner, "asst@example.com", now)).rejects.toMatchObject({ code: "not_duo" });
    await plan(owner, "solo");
    await expect(inviteSeat(pool, owner, "asst@example.com", now)).rejects.toMatchObject({ code: "not_duo" });
    await plan(owner, "duo");
    await expect(inviteSeat(pool, owner, "OWNER@example.com", now)).rejects.toMatchObject({ code: "own_email" });
    await expect(inviteSeat(pool, owner, "not an email", now)).rejects.toMatchObject({ code: "invalid_email" });
  });

  it("invites by email, emails the invitation, and lets only that email accept", async () => {
    await inviteSeat(pool, owner, "asst@example.com", now);
    expect(await seatFor(pool, owner.id)).toEqual({ email: "asst@example.com", accepted: false, memberName: null });
    expect(await pendingInvite(pool, stranger)).toBeNull();
    expect(await acceptSeat(pool, stranger)).toBe(false);
    expect(await pendingInvite(pool, member)).toEqual({ ownerId: owner.id, ownerName: "Owner Priya" }); // email matched without case

    const sent: Mail[] = [];
    await processDueNotifications(pool, { async send(m) { sent.push(m); return { id: "m1" }; } }, { baseUrl: "https://hourhand.test", now });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["asst@example.com", "Owner Priya added you to their Hourhand plan"]]);
    expect(sent[0].replyTo).toBe("owner@example.com");

    expect(await canActFor(pool, member.id, owner.id)).toBe(false); // not before accepting
    expect(await acceptSeat(pool, member)).toBe(true);
    expect(await seatFor(pool, owner.id)).toMatchObject({ accepted: true, memberName: "Assistant Ravi" });
    expect(await seatOwner(pool, member.id)).toEqual({ id: owner.id, name: "Owner Priya" });
    expect(await canActFor(pool, member.id, owner.id)).toBe(true);
    expect(await canActFor(pool, stranger.id, owner.id)).toBe(false);
    expect(await canActFor(pool, member.id, other.id)).toBe(false);
  });

  it("gives the second person Duo on their own account, but never to pass on", async () => {
    expect(await hostPlan(pool, member.id)).toBe("duo");
    expect(await ownPlan(pool, member.id)).toBe("free");
    await expect(inviteSeat(pool, member, "stranger@example.com", now)).rejects.toMatchObject({ code: "not_duo" });
  });

  it("keeps a person on one Duo plan at most", async () => {
    await plan(other, "duo");
    await expect(inviteSeat(pool, other, "ASST@example.com", now)).rejects.toMatchObject({ code: "taken" });
    // Two owners racing: the pre-check passes for both, the unique index refuses the second as "taken", not a crash.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("insert into seats (owner_id, member_email) values ($1, 'race@example.com')", [stranger.id]);
      const racer = { query: (sql: string, params?: unknown[]) => (/^select 1 from seats/.test(sql.trim()) ? Promise.resolve({ rows: [] }) : client.query(sql, params)) };
      await expect(inviteSeat(racer as never, other, "race@example.com", now)).rejects.toMatchObject({ code: "taken" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("sends one invitation a day however often the owner presses the button", async () => {
    const before = (await pool.query("select count(*)::int as n from notifications where kind = 'seat_invite'")).rows[0].n;
    await inviteSeat(pool, other, "fresh@example.com", new Date(now.getTime() + 60_000));
    await inviteSeat(pool, other, "Fresh@example.com", new Date(now.getTime() + 120_000));
    await inviteSeat(pool, other, "fresh@example.com", new Date(now.getTime() + 180_000));
    expect((await pool.query("select count(*)::int as n from notifications where kind = 'seat_invite'")).rows[0].n).toBe(before + 1);
    await removeSeat(pool, other.id);
  });

  it("caps invitation emails per owner across addresses, and frees an address held by a stale invitation", async () => {
    // "fresh@" above already counts today; two more fit, the fourth address is refused.
    const at = (m: number) => new Date(now.getTime() + m * 60_000);
    await inviteSeat(pool, other, "second@example.com", at(10));
    await inviteSeat(pool, other, "third@example.com", at(11));
    await expect(inviteSeat(pool, other, "fourth@example.com", at(12))).rejects.toMatchObject({ code: "too_many" });
    await removeSeat(pool, other.id);
    // A week-old invitation nobody accepted no longer blocks another owner.
    await pool.query("insert into seats (owner_id, member_email, invited_at) values ($1, 'stale@example.com', $2)", [stranger.id, new Date(now.getTime() - 8 * 86_400_000)]);
    await inviteSeat(pool, other, "stale@example.com", new Date(now.getTime() + 2 * 86_400_000));
    expect((await pool.query("select owner_id from seats where member_email = 'stale@example.com'")).rows.map((r) => r.owner_id)).toEqual([other.id]);
    await removeSeat(pool, other.id);
  });

  it("ends at once when the owner's plan lapses, and comes back when it's paid again", async () => {
    await plan(owner, "duo", "cancelled");
    expect(await canActFor(pool, member.id, owner.id)).toBe(false);
    expect(await hostPlan(pool, member.id)).toBe("free");
    await plan(owner, "duo", "past_due"); // still retrying a payment: the plan stands
    expect(await canActFor(pool, member.id, owner.id)).toBe(true);
    await plan(owner, "solo");
    expect(await canActFor(pool, member.id, owner.id)).toBe(false);
    await plan(owner, "duo");
  });

  it("ends when the owner removes them or invites someone else, or when they leave", async () => {
    await inviteSeat(pool, owner, "asst@example.com", now); // same email again: still accepted
    expect(await canActFor(pool, member.id, owner.id)).toBe(true);
    // A queued invitation to the old email is dropped once the seat has moved on.
    const t1 = new Date(now.getTime() + 1000), t2 = new Date(now.getTime() + 2000);
    await pool.query("delete from seats where owner_id = $1", [owner.id]);
    await inviteSeat(pool, owner, "asst@example.com", t1);
    await inviteSeat(pool, owner, "stranger@example.com", t2);
    expect(await canActFor(pool, member.id, owner.id)).toBe(false);
    expect(await seatFor(pool, owner.id)).toMatchObject({ email: "stranger@example.com", accepted: false });
    const sent: Mail[] = [];
    await processDueNotifications(pool, { async send(m) { sent.push(m); return { id: `m${sent.length}` }; } }, { baseUrl: "https://hourhand.test", now: t2 });
    expect(sent.map((m) => m.to)).toEqual(["stranger@example.com"]);
    await acceptSeat(pool, stranger);
    expect(await canActFor(pool, stranger.id, owner.id)).toBe(true);
    await leaveSeat(pool, stranger);
    expect(await seatFor(pool, owner.id)).toBeNull();

    await inviteSeat(pool, owner, "asst@example.com", now);
    await acceptSeat(pool, member);
    await removeSeat(pool, owner.id);
    expect(await canActFor(pool, member.id, owner.id)).toBe(false);
    expect(await hostPlan(pool, member.id)).toBe("free");
  });

  it("ends when the owner closes their account", async () => {
    await inviteSeat(pool, owner, "asst@example.com", now);
    await acceptSeat(pool, member);
    await pool.query("update users set deleted_at = now() where id = $1", [owner.id]);
    expect(await canActFor(pool, member.id, owner.id)).toBe(false);
    expect(await hostPlan(pool, member.id)).toBe("free");
  });
});
