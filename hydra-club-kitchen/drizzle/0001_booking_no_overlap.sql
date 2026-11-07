-- Double booking is impossible at the database level: no two live bookings
-- (pending or confirmed) may overlap in time on the same table.
-- Half-open ranges: a booking ending at 22:00 does not clash with one starting at 22:00.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("table_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" IN ('pending', 'confirmed'));
