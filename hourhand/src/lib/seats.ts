import type pg from "pg";
import { getHostSubscription } from "./billing/account";
import { effectivePlan, type Plan } from "./billing/plans";

// The Duo plan's second person. Everything here takes the signed-in person's own id: an owner manages only their own
// seat, and a member can act for an owner only while that owner is on Duo and their acceptance stands.

type Db = Pick<pg.Pool, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SeatError = "not_duo" | "invalid_email" | "own_email" | "taken";
export class SeatActionError extends Error {
  constructor(readonly code: SeatError) { super(`seat: ${code}`); this.name = "SeatActionError"; }
}

/** The plan from the person's own subscription only (never through a seat), so a seat can't lend a plan onward. */
export async function ownPlan(db: Db, userId: string): Promise<Plan> {
  const s = await getHostSubscription(db, userId);
  return effectivePlan(s && s.plan !== "free" ? { plan: s.plan, status: s.status } : null);
}

export interface Seat { email: string; accepted: boolean; memberName: string | null }

export async function seatFor(db: Db, ownerId: string): Promise<Seat | null> {
  const { rows: [r] } = await db.query(
    "select s.member_email, s.accepted_at, u.name from seats s left join users u on u.id = s.member_id where s.owner_id = $1", [ownerId]);
  return r ? { email: r.member_email, accepted: r.accepted_at !== null, memberName: r.name } : null;
}

/** Invites (or replaces) the owner's second person and queues the invitation email. Needs the owner on Duo. */
export async function inviteSeat(db: Db, owner: { id: string; email: string }, rawEmail: string, now: Date): Promise<void> {
  const email = rawEmail.trim();
  if (!EMAIL.test(email) || email.length > 254) throw new SeatActionError("invalid_email");
  if (email.toLowerCase() === owner.email.toLowerCase()) throw new SeatActionError("own_email");
  if ((await ownPlan(db, owner.id)) !== "duo") throw new SeatActionError("not_duo");
  const { rows: [other] } = await db.query("select 1 from seats where member_email = $1 and owner_id <> $2", [email, owner.id]);
  if (other) throw new SeatActionError("taken");
  // A different email starts over; the same email again just re-sends the invitation. The row and its email are one
  // statement, so neither exists without the other.
  await db.query(
    `with seat as (
       insert into seats (owner_id, member_email, invited_at) values ($1, $2, $3)
       on conflict (owner_id) do update set member_email = excluded.member_email, invited_at = excluded.invited_at,
         member_id = case when seats.member_email = excluded.member_email then seats.member_id end,
         accepted_at = case when seats.member_email = excluded.member_email then seats.accepted_at end
       returning owner_id, member_email)
     insert into notifications (booking_id, user_id, channel, kind, recipient, send_at, dedupe_key)
     select null, owner_id, 'email', 'seat_invite', member_email, $3, $4 from seat on conflict (dedupe_key) do nothing`,
    [owner.id, email, now, `seat:${owner.id}:${now.getTime()}`]);
}

export async function removeSeat(db: Db, ownerId: string): Promise<void> {
  await db.query("delete from seats where owner_id = $1", [ownerId]);
}

/** An invitation waiting for this person (by their verified sign-in email), from an owner still on Duo. */
export async function pendingInvite(db: Db, member: { id: string; email: string }): Promise<{ ownerId: string; ownerName: string } | null> {
  const { rows: [r] } = await db.query(
    `select s.owner_id, u.name from seats s join users u on u.id = s.owner_id
     where s.member_email = $1 and s.accepted_at is null and s.owner_id <> $2 and u.deleted_at is null`, [member.email, member.id]);
  if (!r || (await ownPlan(db, r.owner_id)) !== "duo") return null;
  return { ownerId: r.owner_id, ownerName: r.name };
}

export async function acceptSeat(db: Db, member: { id: string; email: string }): Promise<boolean> {
  const invite = await pendingInvite(db, member);
  if (!invite) return false;
  const { rowCount } = await db.query(
    "update seats set member_id = $1, accepted_at = now() where owner_id = $2 and member_email = $3 and accepted_at is null", [member.id, invite.ownerId, member.email]);
  return Boolean(rowCount);
}

/** The member says no, or leaves later. */
export async function leaveSeat(db: Db, member: { id: string; email: string }): Promise<void> {
  await db.query("delete from seats where member_email = $1 or member_id = $2", [member.email, member.id]);
}

/** The owner this person is the accepted second person for, while that owner is on Duo. */
export async function seatOwner(db: Db, memberId: string): Promise<{ id: string; name: string } | null> {
  if (!UUID.test(memberId)) return null;
  const { rows: [r] } = await db.query(
    `select u.id, u.name from seats s join users u on u.id = s.owner_id
     where s.member_id = $1 and s.accepted_at is not null and u.deleted_at is null`, [memberId]);
  if (!r || (await ownPlan(db, r.id)) !== "duo") return null;
  return { id: r.id, name: r.name };
}

/** May `memberId` act for `ownerId` right now? Checked on every request, so a removed seat or a lapsed plan ends it at once. */
export async function canActFor(db: Db, memberId: string, ownerId: string): Promise<boolean> {
  if (!UUID.test(ownerId)) return false;
  return (await seatOwner(db, memberId))?.id === ownerId;
}
