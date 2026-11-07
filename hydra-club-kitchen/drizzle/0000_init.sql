CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."night_accent" AS ENUM('rose', 'amber', 'aqua');--> statement-breakpoint
CREATE TYPE "public"."photo_tag" AS ENUM('club', 'kitchen', 'bar', 'floor');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'host');--> statement-breakpoint
CREATE TYPE "public"."zone_key" AS ENUM('standard', 'vip', 'vvip', 'mezz');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"table_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"service_date" date GENERATED ALWAYS AS ((((starts_at AT TIME ZONE 'Asia/Kolkata') - interval '5 hours'))::date) STORED,
	"guests" integer NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"notes" text,
	"contact_consent_at" timestamp with time zone,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"utm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_ref_unique" UNIQUE("ref"),
	CONSTRAINT "bookings_time_order" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_guests_range" CHECK ("bookings"."guests" BETWEEN 1 AND 50),
	CONSTRAINT "bookings_ref_format" CHECK ("bookings"."ref" ~ '^HYD-[A-Z0-9]{4}$'),
	CONSTRAINT "bookings_phone_in_mobile" CHECK ("bookings"."phone_e164" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "bookings_name_len" CHECK (char_length("bookings"."name") BETWEEN 1 AND 80),
	CONSTRAINT "bookings_notes_len" CHECK ("bookings"."notes" IS NULL OR char_length("bookings"."notes") <= 500)
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_paise" integer,
	"veg" boolean NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_items_price_nonneg" CHECK ("menu_items"."price_paise" IS NULL OR "menu_items"."price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nights" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"days" text NOT NULL,
	"blurb" text NOT NULL,
	"accent" "night_accent" NOT NULL,
	"cta_date_rule" text,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "nights_cta_rule_format" CHECK ("nights"."cta_date_rule" IS NULL OR "nights"."cta_date_rule" ~ '^[1-7](,[1-7])*$')
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" "photo_tag" NOT NULL,
	"alt" text NOT NULL,
	"hero" boolean DEFAULT false NOT NULL,
	"hero_scene" "photo_tag",
	"sort" integer DEFAULT 0 NOT NULL,
	"original_key" text NOT NULL,
	"avif_url" text NOT NULL,
	"webp_url" text NOT NULL,
	"blurhash" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_original_key_unique" UNIQUE("original_key"),
	CONSTRAINT "photos_hero_scene_needs_hero" CHECK ("photos"."hero_scene" IS NULL OR "photos"."hero"),
	CONSTRAINT "photos_dims_positive" CHECK ("photos"."width" > 0 AND "photos"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "table_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer,
	"zone_id" integer,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_holds_one_target" CHECK (num_nonnulls("table_holds"."table_id", "table_holds"."zone_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"zone_id" integer NOT NULL,
	"seats" integer,
	"svg_ref" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tables_code_unique" UNIQUE("code"),
	CONSTRAINT "tables_seats_positive" CHECK ("tables"."seats" IS NULL OR "tables"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" "zone_key" NOT NULL,
	"name" text NOT NULL,
	"colour" text NOT NULL,
	"note" text,
	"seats" integer,
	"min_spend_paise" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "zones_key_unique" UNIQUE("key"),
	CONSTRAINT "zones_colour_hex" CHECK ("zones"."colour" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "zones_seats_positive" CHECK ("zones"."seats" IS NULL OR "zones"."seats" > 0),
	CONSTRAINT "zones_min_spend_nonneg" CHECK ("zones"."min_spend_paise" IS NULL OR "zones"."min_spend_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_holds" ADD CONSTRAINT "table_holds_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_holds" ADD CONSTRAINT "table_holds_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_holds" ADD CONSTRAINT "table_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "bookings_service_date_idx" ON "bookings" USING btree ("service_date","status");--> statement-breakpoint
CREATE INDEX "bookings_table_idx" ON "bookings" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "bookings_phone_idx" ON "bookings" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "menu_items_category_idx" ON "menu_items" USING btree ("category_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_hero_scene_uq" ON "photos" USING btree ("hero_scene") WHERE "photos"."hero_scene" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "photos_tag_sort_idx" ON "photos" USING btree ("tag","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "table_holds_table_date_uq" ON "table_holds" USING btree ("table_id","date") WHERE "table_holds"."table_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "table_holds_zone_date_uq" ON "table_holds" USING btree ("zone_id","date") WHERE "table_holds"."zone_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "table_holds_date_idx" ON "table_holds" USING btree ("date");--> statement-breakpoint
CREATE INDEX "tables_zone_idx" ON "tables" USING btree ("zone_id");