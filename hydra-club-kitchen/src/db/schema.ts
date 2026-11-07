import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Service-day cutoff, in Asia/Kolkata hours. A booking that starts before this
 * hour belongs to the previous day's service (the club closes at 1 AM, so a
 * 12:30 AM slot on the 9th is part of the 8th's night). The generated column
 * `bookings.service_date` hardcodes the same value; tests pin the two together.
 */
export const SERVICE_DAY_CUTOFF_HOUR = 5;

export const roleEnum = pgEnum("user_role", ["owner", "manager", "host"]);
export const zoneKeyEnum = pgEnum("zone_key", ["standard", "vip", "vvip", "mezz"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "no_show",
  "completed",
]);
export const photoTagEnum = pgEnum("photo_tag", ["club", "kitchen", "bar", "floor"]);
export const nightAccentEnum = pgEnum("night_accent", ["rose", "amber", "aqua"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** Sessions issued before this instant are rejected (password change, forced logout). */
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const zones = pgTable(
  "zones",
  {
    id: serial("id").primaryKey(),
    key: zoneKeyEnum("key").notNull().unique(),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    note: text("note"),
    seats: integer("seats"),
    minSpendPaise: integer("min_spend_paise"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    check("zones_colour_hex", sql`${t.colour} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("zones_seats_positive", sql`${t.seats} IS NULL OR ${t.seats} > 0`),
    check("zones_min_spend_nonneg", sql`${t.minSpendPaise} IS NULL OR ${t.minSpendPaise} >= 0`),
  ],
);

export const tables = pgTable(
  "tables",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    seats: integer("seats"),
    svgRef: text("svg_ref").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("tables_zone_idx").on(t.zoneId),
    check("tables_seats_positive", sql`${t.seats} IS NULL OR ${t.seats} > 0`),
  ],
);

/**
 * Double booking is blocked by the exclusion constraint `bookings_no_overlap`
 * (btree_gist), added in a hand-written migration because drizzle-kit cannot
 * express EXCLUDE constraints. Ranges are half-open [starts_at, ends_at), so a
 * 20:00-22:00 booking and a 22:00-00:00 booking on the same table both fit.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    tableId: integer("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    serviceDate: date("service_date").generatedAlwaysAs(
      sql`(((starts_at AT TIME ZONE 'Asia/Kolkata') - interval '5 hours'))::date`,
    ),
    guests: integer("guests").notNull(),
    name: text("name").notNull(),
    /** Null only for walk-ins (bookings_phone_required). */
    phoneE164: text("phone_e164"),
    notes: text("notes"),
    contactConsentAt: timestamp("contact_consent_at", { withTimezone: true }),
    status: bookingStatusEnum("status").notNull().default("pending"),
    source: text("source").notNull().default("web"),
    utm: jsonb("utm").$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_service_date_idx").on(t.serviceDate, t.status),
    index("bookings_table_idx").on(t.tableId),
    index("bookings_phone_idx").on(t.phoneE164),
    check("bookings_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_guests_range", sql`${t.guests} BETWEEN 1 AND 50`),
    check("bookings_ref_format", sql`${t.ref} ~ '^HYD-[A-Z0-9]{4}$'`),
    check("bookings_phone_in_mobile", sql`${t.phoneE164} ~ '^\\+91[6-9][0-9]{9}$'`),
    check("bookings_phone_required", sql`${t.phoneE164} IS NOT NULL OR ${t.source} = 'walk_in'`),
    check("bookings_name_len", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("bookings_notes_len", sql`${t.notes} IS NULL OR char_length(${t.notes}) <= 500`),
  ],
);

/**
 * A hold blocks either one table or a whole zone for one service date
 * (events, private parties). Exactly one of table_id / zone_id is set.
 */
export const tableHolds = pgTable(
  "table_holds",
  {
    id: serial("id").primaryKey(),
    tableId: integer("table_id").references(() => tables.id, { onDelete: "cascade" }),
    zoneId: integer("zone_id").references(() => zones.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("table_holds_one_target", sql`num_nonnulls(${t.tableId}, ${t.zoneId}) = 1`),
    uniqueIndex("table_holds_table_date_uq").on(t.tableId, t.date).where(sql`${t.tableId} IS NOT NULL`),
    uniqueIndex("table_holds_zone_date_uq").on(t.zoneId, t.date).where(sql`${t.zoneId} IS NOT NULL`),
    index("table_holds_date_idx").on(t.date),
  ],
);

export const photos = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    tag: photoTagEnum("tag").notNull(),
    alt: text("alt").notNull(),
    hero: boolean("hero").notNull().default(false),
    heroScene: photoTagEnum("hero_scene"),
    sort: integer("sort").notNull().default(0),
    originalKey: text("original_key").notNull().unique(),
    avifUrl: text("avif_url").notNull(),
    webpUrl: text("webp_url").notNull(),
    blurhash: text("blurhash").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One hero photo per scene (Club, Kitchen, Bar, Floor).
    uniqueIndex("photos_hero_scene_uq").on(t.heroScene).where(sql`${t.heroScene} IS NOT NULL`),
    check("photos_hero_scene_needs_hero", sql`${t.heroScene} IS NULL OR ${t.hero}`),
    check("photos_dims_positive", sql`${t.width} > 0 AND ${t.height} > 0`),
    index("photos_tag_sort_idx").on(t.tag, t.sort),
  ],
);

export const menuCategories = pgTable("menu_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sort: integer("sort").notNull().default(0),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    pricePaise: integer("price_paise"),
    veg: boolean("veg").notNull(),
    available: boolean("available").notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    index("menu_items_category_idx").on(t.categoryId, t.sort),
    check("menu_items_price_nonneg", sql`${t.pricePaise} IS NULL OR ${t.pricePaise} >= 0`),
  ],
);

export const nights = pgTable(
  "nights",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    days: text("days").notNull(),
    blurb: text("blurb").notNull(),
    accent: nightAccentEnum("accent").notNull(),
    /** ISO weekdays (1 = Mon … 7 = Sun), comma separated, e.g. "5,6". The CTA pre-fills the next matching date. */
    ctaDateRule: text("cta_date_rule"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [check("nights_cta_rule_format", sql`${t.ctaDateRule} IS NULL OR ${t.ctaDateRule} ~ '^[1-7](,[1-7])*$'`)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null for system events (e.g. a failed n8n webhook delivery). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: jsonb("diff"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_at_idx").on(t.at)],
);

/**
 * Sliding-window rate limiting without Redis: one row per counted hit.
 * Keys look like "login:email:<addr>", "login:ip:<ip>", "booking:ip:<ip>".
 */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limit_hits_key_at_idx").on(t.key, t.at), index("rate_limit_hits_at_idx").on(t.at)],
);
