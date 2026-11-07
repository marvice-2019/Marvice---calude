import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { auditLog, bookings, tableHolds, tables, zones } from "@/db/schema";
import type { BookingEventPayload, BookingEventType } from "@/lib/notify";
import { consume } from "@/lib/rate-limit";
import { bookingOpen, type Settings } from "@/lib/settings";
import { toIndianE164 } from "./phone";
import { bookableDates, isHHmm, isIsoDate, serviceDateOf, slotsFor, type Slot } from "./time";

export const BOOKING_RATE_LIMIT = { limit: 5, windowSec: 3600 };
/** Guest lookups and cancels per IP: stops anyone guessing refs + last-4 digits. */
export const LOOKUP_RATE_LIMIT = { limit: 20, windowSec: 3600 };
const LIVE = ["pending", "confirmed"] as const;

export type Fail = { ok: false; status: number; code: string; message: string; [extra: string]: unknown };
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): Fail => ({
  ok: false,
  status,
  code,
  message,
  ...extra,
});

export type TableState = "available" | "booked" | "held";
export type TableAvailability = { code: string; zone: string; seats: number | null; state: TableState };
export type BookingSummary = {
  ref: string;
  status: string;
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
  table: string;
  zone: string;
  guests: number;
  name: string;
};
/** An event the caller should hand to deliverBookingEvent once the response is sent. */
export type PendingEvent = { type: BookingEventType; payload: BookingEventPayload };

export const istTime = (d: Date) =>
  new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

// ---------------------------------------------------------------------------
// Availability

/** Validates a service date against the booking window and booking switch. */
function checkDate(s: Settings, date: string, now: Date): Fail | null {
  if (!bookingOpen(s)) return fail(503, "booking_closed", "Online booking isn't open yet. Message us on Instagram.");
  if (!isIsoDate(date)) return fail(400, "bad_date", "Pick a date.");
  if (!bookableDates(now, s.booking_window_days).includes(date)) {
    return fail(400, "date_out_of_window", `You can book up to ${s.booking_window_days} days ahead.`);
  }
  return null;
}

function findSlot(s: Settings, date: string, time: string, now: Date): Slot | Fail {
  if (!isHHmm(time)) return fail(400, "bad_time", "Pick a time.");
  const slot = slotsFor(s.hours, date, s.slot_length_minutes).find((x) => x.time === time);
  if (!slot) return fail(400, "bad_time", "That time isn't a booking slot on this day.");
  if (slot.startsAt.getTime() <= now.getTime()) return fail(400, "slot_passed", "That time has already passed.");
  return slot;
}

async function loadFloor(db: Db, date: string) {
  const [tableRows, holdRows, bookingRows] = await Promise.all([
    db
      .select({ id: tables.id, code: tables.code, zoneId: tables.zoneId, zone: zones.key, seats: tables.seats, zoneSort: zones.sort })
      .from(tables)
      .innerJoin(zones, eq(zones.id, tables.zoneId))
      .where(eq(tables.active, true))
      .orderBy(asc(zones.sort), asc(tables.id)),
    db.select({ tableId: tableHolds.tableId, zoneId: tableHolds.zoneId }).from(tableHolds).where(eq(tableHolds.date, date)),
    db
      .select({ tableId: bookings.tableId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
      .from(bookings)
      .where(and(eq(bookings.serviceDate, date), inArray(bookings.status, [...LIVE]))),
  ]);
  const heldTables = new Set(holdRows.map((h) => h.tableId).filter((x): x is number => x !== null));
  const heldZones = new Set(holdRows.map((h) => h.zoneId).filter((x): x is number => x !== null));
  const stateAt = (t: (typeof tableRows)[number], slot: Slot): TableState => {
    if (heldTables.has(t.id) || heldZones.has(t.zoneId)) return "held";
    const clash = bookingRows.some(
      (b) => b.tableId === t.id && b.startsAt < slot.endsAt && b.endsAt > slot.startsAt,
    );
    return clash ? "booked" : "available";
  };
  return { tableRows, stateAt };
}

/** Time chips for a date, each with how many tables are still free. */
export async function getSlots(db: Db, s: Settings, date: string, now = new Date()) {
  const bad = checkDate(s, date, now);
  if (bad) return bad;
  const { tableRows, stateAt } = await loadFloor(db, date);
  const slots = slotsFor(s.hours, date, s.slot_length_minutes)
    .filter((slot) => slot.startsAt > now)
    .map((slot) => ({ time: slot.time, available: tableRows.filter((t) => stateAt(t, slot) === "available").length }));
  return { ok: true as const, date, slots };
}

/** Every bookable table's state for one date and time (drives the floor plan). */
export async function getAvailability(db: Db, s: Settings, date: string, time: string, now = new Date()) {
  const bad = checkDate(s, date, now);
  if (bad) return bad;
  const slot = findSlot(s, date, time, now);
  if ("ok" in slot) return slot;
  const { tableRows, stateAt } = await loadFloor(db, date);
  const result: TableAvailability[] = tableRows.map((t) => ({ code: t.code, zone: t.zone, seats: t.seats, state: stateAt(t, slot) }));
  return { ok: true as const, date, time, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), tables: result };
}

// ---------------------------------------------------------------------------
// Create

const utmSchema = z
  .object({
    utm_source: z.string().max(200),
    utm_medium: z.string().max(200),
    utm_campaign: z.string().max(200),
    utm_term: z.string().max(200),
    utm_content: z.string().max(200),
    gclid: z.string().max(200),
    fbclid: z.string().max(200),
  })
  .partial()
  .strict();

const cleanText = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

export const createBookingSchema = z.object({
  table: z.string().max(20),
  date: z.string(),
  time: z.string(),
  guests: z.coerce.number().int().min(1, "At least 1 guest."),
  name: cleanText(80).pipe(z.string().min(1, "Tell us your name.")),
  phone: z.string().max(30),
  notes: cleanText(500).optional().default(""),
  consent: z.literal(true, { error: "Tick the box so we can contact you about this booking." }),
  /** Honeypot. Real people never see this field. */
  website: z.string().optional(),
  utm: utmSchema.optional(),
  captchaToken: z.string().max(4096).optional(),
});

export type CreateContext = {
  ip: string;
  now?: Date;
  /** Only called when settings.captcha_enabled is on. */
  verifyCaptcha?: (token: string | undefined, ip: string) => Promise<boolean>;
  source?: string;
};

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I: read out over the phone
export const newRef = () => `HYD-${Array.from({ length: 4 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("")}`;

const pgCode = (err: unknown): string | undefined =>
  (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
const pgConstraint = (err: unknown): string | undefined =>
  (err as { cause?: { constraint_name?: string } }).cause?.constraint_name ??
  (err as { constraint_name?: string }).constraint_name;

export async function createBooking(
  db: Db,
  s: Settings,
  raw: unknown,
  ctx: CreateContext,
): Promise<{ ok: true; booking: BookingSummary; event: PendingEvent | null } | Fail> {
  const now = ctx.now ?? new Date();

  // Bots that fill the hidden field get a convincing success and nothing is stored.
  if (raw && typeof raw === "object" && typeof (raw as { website?: unknown }).website === "string" && (raw as { website: string }).website.trim() !== "") {
    return { ok: true, booking: decoy(newRef()), event: null };
  }

  const limited = await consume(db, `booking:ip:${ctx.ip}`, BOOKING_RATE_LIMIT.limit, BOOKING_RATE_LIMIT.windowSec);
  if (!limited.ok) {
    return fail(429, "rate_limited", "Too many booking attempts. Message us on Instagram and we'll sort it.", {
      retryAfterSec: limited.retryAfterSec,
    });
  }

  if (s.captcha_enabled) {
    const token = (raw as { captchaToken?: string } | null)?.captchaToken;
    if (!ctx.verifyCaptcha || !(await ctx.verifyCaptcha(token, ctx.ip))) {
      return fail(400, "captcha_failed", "Please complete the check and try again.");
    }
  }

  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[String(i.path[0] ?? "form")] ??= i.message;
    return fail(400, "invalid", "Check the highlighted fields.", { fields });
  }
  const input = parsed.data;

  const phone = toIndianE164(input.phone);
  if (!phone) return fail(400, "invalid", "Check the highlighted fields.", { fields: { phone: "Enter a 10-digit Indian mobile number." } });

  const badDate = checkDate(s, input.date, now);
  if (badDate) return badDate;
  const slot = findSlot(s, input.date, input.time, now);
  if ("ok" in slot) return slot;

  const [table] = await db
    .select({ id: tables.id, code: tables.code, seats: tables.seats, zoneId: tables.zoneId, zone: zones.key })
    .from(tables)
    .innerJoin(zones, eq(zones.id, tables.zoneId))
    .where(and(eq(tables.code, input.table), eq(tables.active, true)));
  if (!table) return fail(400, "bad_table", "Pick a table on the floor plan.");

  const maxGuests = Math.min(s.max_guests_per_table, table.seats ?? Number.POSITIVE_INFINITY);
  if (input.guests > maxGuests) {
    return fail(400, "invalid", "Check the highlighted fields.", { fields: { guests: `${table.code} takes up to ${maxGuests} guests.` } });
  }

  const [hold] = await db
    .select({ id: tableHolds.id })
    .from(tableHolds)
    .where(
      and(
        eq(tableHolds.date, input.date),
        or(eq(tableHolds.tableId, table.id), eq(tableHolds.zoneId, table.zoneId)),
      ),
    );
  if (hold) return taken(db, s, input.date, input.time, table.code, now, "held");

  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = newRef();
    try {
      const [row] = await db
        .insert(bookings)
        .values({
          ref,
          tableId: table.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          guests: input.guests,
          name: input.name,
          phoneE164: phone,
          notes: input.notes || null,
          contactConsentAt: now,
          status: "pending",
          source: ctx.source ?? "web",
          utm: input.utm && Object.keys(input.utm).length > 0 ? (input.utm as Record<string, string>) : null,
        })
        .returning();
      const booking = summarise(row!, table.code, table.zone);
      return { ok: true, booking, event: { type: "booking.created", payload: eventPayload(booking, row!) } };
    } catch (err) {
      if (pgCode(err) === "23P01") return taken(db, s, input.date, input.time, table.code, now, "booked");
      if (pgCode(err) === "23505" && pgConstraint(err) === "bookings_ref_unique") continue; // ref collision: new ref
      throw err;
    }
  }
  throw new Error("Could not allocate a unique booking reference");
}

/** "That table was just taken", with up to 5 free tables at the same time, same zone first. */
async function taken(db: Db, s: Settings, date: string, time: string, code: string, now: Date, why: "booked" | "held"): Promise<Fail> {
  const avail = await getAvailability(db, s, date, time, now);
  let alternatives: { code: string; zone: string }[] = [];
  if (avail.ok) {
    const wanted = avail.tables.find((t) => t.code === code);
    alternatives = avail.tables
      .filter((t) => t.state === "available")
      .sort((a, b) => Number(b.zone === wanted?.zone) - Number(a.zone === wanted?.zone))
      .slice(0, 5)
      .map(({ code: c, zone }) => ({ code: c, zone }));
  }
  const message = why === "held" ? `${code} is reserved that night. Try another table.` : "That table was just taken. Try another one.";
  return fail(409, "table_taken", message, { alternatives });
}

function summarise(row: typeof bookings.$inferSelect, table: string, zone: string): BookingSummary {
  return {
    ref: row.ref,
    status: row.status,
    date: row.serviceDate ?? serviceDateOf(row.startsAt),
    time: istTime(row.startsAt),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    table,
    zone,
    guests: row.guests,
    name: row.name,
  };
}

function eventPayload(b: BookingSummary, row: typeof bookings.$inferSelect, extra: Partial<BookingEventPayload> = {}): BookingEventPayload {
  return {
    ref: b.ref,
    status: b.status,
    table: b.table,
    zone: b.zone,
    service_date: b.date,
    time: b.time,
    starts_at: b.startsAt,
    ends_at: b.endsAt,
    guests: b.guests,
    name: b.name,
    phone_e164: row.phoneE164,
    notes: row.notes,
    ...extra,
  };
}

function decoy(ref: string): BookingSummary {
  const t = new Date().toISOString();
  return { ref, status: "pending", date: t.slice(0, 10), time: "21:00", startsAt: t, endsAt: t, table: "", zone: "", guests: 1, name: "" };
}

// ---------------------------------------------------------------------------
// Guest lookup and cancel (ref + last 4 digits of the phone)

const lookupSchema = z.object({ ref: z.string().regex(/^HYD-[A-Z0-9]{4}$/), last4: z.string().regex(/^\d{4}$/) });

async function findByRef(db: Db, raw: unknown) {
  const parsed = lookupSchema.safeParse(raw);
  if (!parsed.success) return null;
  const [row] = await db
    .select({ b: bookings, table: tables.code, zone: zones.key })
    .from(bookings)
    .innerJoin(tables, eq(tables.id, bookings.tableId))
    .innerJoin(zones, eq(zones.id, tables.zoneId))
    .where(eq(bookings.ref, parsed.data.ref));
  // Same answer for an unknown ref and a wrong last-4, so refs can't be probed.
  if (!row || !row.b.phoneE164.endsWith(parsed.data.last4)) return null;
  return row;
}

const NOT_FOUND = () => fail(404, "not_found", "We couldn't find that booking. Check the reference and the last 4 digits of your phone.");

export async function lookupBooking(db: Db, raw: unknown) {
  const row = await findByRef(db, raw);
  if (!row) return NOT_FOUND();
  return { ok: true as const, booking: summarise(row.b, row.table, row.zone) };
}

export async function cancelByGuest(db: Db, raw: unknown, now = new Date()) {
  const row = await findByRef(db, raw);
  if (!row) return NOT_FOUND();
  if (!(LIVE as readonly string[]).includes(row.b.status)) return fail(409, "not_cancellable", "This booking is already closed.");
  if (row.b.startsAt <= now) return fail(409, "not_cancellable", "This booking has started. Talk to the host.");
  const [updated] = await db
    .update(bookings)
    .set({ status: "cancelled", updatedAt: sql`now()` })
    .where(and(eq(bookings.id, row.b.id), inArray(bookings.status, [...LIVE])))
    .returning();
  if (!updated) return fail(409, "not_cancellable", "This booking is already closed.");
  await db.insert(auditLog).values({
    userId: null,
    action: "booking.cancelled_by_guest",
    entity: "booking",
    entityId: updated.ref,
    diff: { from: row.b.status, to: "cancelled" },
  });
  const booking = summarise(updated, row.table, row.zone);
  return {
    ok: true as const,
    booking,
    event: { type: "booking.cancelled", payload: eventPayload(booking, updated, { cancelled_by: "guest" }) } satisfies PendingEvent,
  };
}

/** Booking data for the calendar file, behind the same ref + last-4 check. */
export async function bookingForIcs(db: Db, raw: unknown) {
  const row = await findByRef(db, raw);
  if (!row) return null;
  return { ref: row.b.ref, table: row.table, guests: row.b.guests, startsAt: row.b.startsAt, endsAt: row.b.endsAt };
}

// ---------------------------------------------------------------------------
// Admin

export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "no_show", "completed"] as const;
type Status = (typeof BOOKING_STATUSES)[number];

export const adminListSchema = z.object({
  date: z.string().refine(isIsoDate).optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  zone: z.enum(["standard", "vip", "vvip", "mezz"]).optional(),
});

export async function adminListBookings(db: Db, raw: unknown, now = new Date()) {
  const parsed = adminListSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", "Bad filter.");
  const date = parsed.data.date ?? serviceDateOf(now);
  const rows = await db
    .select({ b: bookings, table: tables.code, zone: zones.key })
    .from(bookings)
    .innerJoin(tables, eq(tables.id, bookings.tableId))
    .innerJoin(zones, eq(zones.id, tables.zoneId))
    .where(
      and(
        eq(bookings.serviceDate, date),
        parsed.data.status ? eq(bookings.status, parsed.data.status) : undefined,
        parsed.data.zone ? eq(zones.key, parsed.data.zone) : undefined,
      ),
    )
    .orderBy(asc(bookings.startsAt), asc(tables.id));
  return {
    ok: true as const,
    date,
    bookings: rows.map((r) => ({
      id: r.b.id,
      ...summarise(r.b, r.table, r.zone),
      phone: r.b.phoneE164,
      notes: r.b.notes,
      source: r.b.source,
      createdAt: r.b.createdAt.toISOString(),
    })),
  };
}

/** Which status changes staff can make, keyed by the action they press. */
export const TRANSITIONS: Record<"confirm" | "cancel" | "no_show" | "complete", { from: Status[]; to: Status; event: BookingEventType }> = {
  confirm: { from: ["pending"], to: "confirmed", event: "booking.confirmed" },
  cancel: { from: ["pending", "confirmed"], to: "cancelled", event: "booking.cancelled" },
  no_show: { from: ["pending", "confirmed"], to: "no_show", event: "booking.no_show" },
  complete: { from: ["confirmed"], to: "completed", event: "booking.completed" },
};

export const adminPatchSchema = z.object({
  id: z.uuid(),
  action: z.enum(["confirm", "cancel", "no_show", "complete"]),
});

export async function adminTransition(db: Db, userId: string, raw: unknown) {
  const parsed = adminPatchSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", "Bad request.");
  const rule = TRANSITIONS[parsed.data.action];
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ b: bookings, table: tables.code, zone: zones.key })
      .from(bookings)
      .innerJoin(tables, eq(tables.id, bookings.tableId))
      .innerJoin(zones, eq(zones.id, tables.zoneId))
      .where(eq(bookings.id, parsed.data.id))
      .for("update", { of: bookings });
    if (!row) return fail(404, "not_found", "Booking not found.");
    if (!rule.from.includes(row.b.status)) {
      return fail(409, "bad_transition", `Can't ${parsed.data.action.replace("_", "-")} a ${row.b.status.replace("_", "-")} booking.`);
    }
    const [updated] = await tx
      .update(bookings)
      .set({ status: rule.to, updatedAt: sql`now()` })
      .where(eq(bookings.id, row.b.id))
      .returning();
    await tx.insert(auditLog).values({
      userId,
      action: `booking.${parsed.data.action}`,
      entity: "booking",
      entityId: updated!.ref,
      diff: { status: { from: row.b.status, to: rule.to } },
    });
    const booking = summarise(updated!, row.table, row.zone);
    return {
      ok: true as const,
      booking,
      event: {
        type: rule.event,
        payload: eventPayload(booking, updated!, rule.to === "cancelled" ? { cancelled_by: "staff" } : {}),
      } satisfies PendingEvent,
    };
  });
}

export const holdSchema = z
  .object({
    table: z.string().max(20).optional(),
    zone: z.enum(["standard", "vip", "vvip", "mezz"]).optional(),
    date: z.string().refine(isIsoDate, "Pick a date."),
    reason: z.string().trim().min(1, "Say why (e.g. private party).").max(200),
  })
  .refine((v) => Boolean(v.table) !== Boolean(v.zone), { message: "Hold either one table or one zone." });

/** Block a table or a zone for a service date. Returns live bookings it overlaps so staff can contact those guests. */
export async function createHold(db: Db, userId: string, raw: unknown) {
  const parsed = holdSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Bad request.");
  const { table, zone, date, reason } = parsed.data;

  let tableId: number | null = null;
  let zoneId: number | null = null;
  if (table) {
    const [t] = await db.select({ id: tables.id }).from(tables).where(eq(tables.code, table));
    if (!t) return fail(400, "bad_table", "No such table.");
    tableId = t.id;
  } else {
    const [z2] = await db.select({ id: zones.id }).from(zones).where(eq(zones.key, zone!));
    zoneId = z2!.id;
  }

  try {
    const [hold] = await db.insert(tableHolds).values({ tableId, zoneId, date, reason, createdBy: userId }).returning();
    await db.insert(auditLog).values({
      userId,
      action: "hold.create",
      entity: "table_hold",
      entityId: String(hold!.id),
      diff: { table: table ?? null, zone: zone ?? null, date, reason },
    });
    const conflicts = await db
      .select({ ref: bookings.ref, table: tables.code, time: bookings.startsAt, name: bookings.name, status: bookings.status })
      .from(bookings)
      .innerJoin(tables, eq(tables.id, bookings.tableId))
      .where(
        and(
          eq(bookings.serviceDate, date),
          inArray(bookings.status, [...LIVE]),
          tableId !== null ? eq(bookings.tableId, tableId) : eq(tables.zoneId, zoneId!),
        ),
      );
    return {
      ok: true as const,
      hold: { id: hold!.id, table: table ?? null, zone: zone ?? null, date, reason },
      conflicts: conflicts.map((c) => ({ ...c, time: istTime(c.time) })),
    };
  } catch (err) {
    if (pgCode(err) === "23505") return fail(409, "already_held", "That's already held for this date.");
    throw err;
  }
}

export async function deleteHold(db: Db, userId: string, rawId: unknown) {
  const id = z.coerce.number().int().positive().safeParse(rawId);
  if (!id.success) return fail(400, "invalid", "Bad hold id.");
  const [deleted] = await db.delete(tableHolds).where(eq(tableHolds.id, id.data)).returning();
  if (!deleted) return fail(404, "not_found", "Hold not found.");
  await db.insert(auditLog).values({
    userId,
    action: "hold.delete",
    entity: "table_hold",
    entityId: String(deleted.id),
    diff: { date: deleted.date, reason: deleted.reason, tableId: deleted.tableId, zoneId: deleted.zoneId },
  });
  return { ok: true as const };
}

export async function listHolds(db: Db, from: string) {
  return db
    .select({ id: tableHolds.id, date: tableHolds.date, reason: tableHolds.reason, table: tables.code, zone: zones.key })
    .from(tableHolds)
    .leftJoin(tables, eq(tables.id, tableHolds.tableId))
    .leftJoin(zones, eq(zones.id, tableHolds.zoneId))
    .where(and(sql`${tableHolds.date} >= ${from}`, or(isNotNull(tableHolds.tableId), isNotNull(tableHolds.zoneId))))
    .orderBy(asc(tableHolds.date));
}
