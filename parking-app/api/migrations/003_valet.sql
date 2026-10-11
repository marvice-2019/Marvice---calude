-- Stage 4 rerun: valet, where I parked, destinations, filters support, account preferences.
-- Valet and parked-spot DDL mirrors ../schema.sql (stage 2 rerun).

CREATE TABLE parked_spots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid REFERENCES bookings(id) ON DELETE CASCADE,
  monthly_pass_id uuid REFERENCES monthly_passes(id) ON DELETE CASCADE,
  floor           varchar(6),
  bay             varchar(8),
  note            varchar(80),
  photo_url       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(booking_id, monthly_pass_id) = 1),
  CHECK (num_nonnulls(floor, bay, note, photo_url) >= 1)
);
CREATE UNIQUE INDEX parked_spots_booking_uq ON parked_spots (booking_id) WHERE booking_id IS NOT NULL;

CREATE TABLE valet_desks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  lot_id          uuid REFERENCES lots(id),
  name            text NOT NULL,
  geo             geography(Point, 4326) NOT NULL,
  fee_paise       int NOT NULL CHECK (fee_paise >= 0),
  typical_eta_min smallint NOT NULL DEFAULT 6,
  is_live         boolean NOT NULL DEFAULT false
);
CREATE INDEX valet_desks_geo_idx ON valet_desks USING gist (geo);

CREATE TABLE valet_validations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id      uuid NOT NULL REFERENCES valet_desks(id),
  validator    text NOT NULL,
  code         varchar(12) NOT NULL,
  valid        tstzrange NOT NULL,
  billed_to_operator_id uuid REFERENCES operators(id),
  UNIQUE (desk_id, code, valid)
);

CREATE TYPE valet_status AS ENUM ('dropped', 'parked', 'requested', 'coming', 'ready', 'closed', 'cancelled');

CREATE TABLE valet_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(8) UNIQUE NOT NULL,
  desk_id         uuid NOT NULL REFERENCES valet_desks(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  key_tag         varchar(8) NOT NULL,
  bay             varchar(12),
  status          valet_status NOT NULL DEFAULT 'dropped',
  handover_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  dropped_by      uuid REFERENCES users(id),
  retrieved_by    uuid REFERENCES users(id),
  validation_id   uuid REFERENCES valet_validations(id),
  fee_paise       int NOT NULL,
  gst_paise       int NOT NULL DEFAULT 0,
  tip_paise       int NOT NULL DEFAULT 0 CHECK (tip_paise >= 0),
  dropped_at      timestamptz NOT NULL DEFAULT now(),
  requested_at    timestamptz,
  ready_at        timestamptz,
  closed_at       timestamptz,
  damage_report   jsonb,
  client_id       text UNIQUE,                     -- staff app retries are deduplicated
  CHECK (jsonb_typeof(handover_photos) = 'array')
);
CREATE UNIQUE INDEX valet_open_tag_uq ON valet_tickets (desk_id, key_tag) WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX valet_queue_idx ON valet_tickets (desk_id, status, requested_at) WHERE status IN ('requested', 'coming');
CREATE INDEX valet_user_idx ON valet_tickets (user_id, dropped_at DESC);

-- Payments can now pay for a valet request.
ALTER TABLE payments ADD COLUMN valet_ticket_id uuid REFERENCES valet_tickets(id);
ALTER TABLE payments DROP CONSTRAINT payments_check;
ALTER TABLE payments ADD CONSTRAINT payments_one_target CHECK (num_nonnulls(booking_id, monthly_pass_id, valet_ticket_id) = 1);
ALTER TABLE payments DROP CONSTRAINT payments_purpose_check;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('booking', 'extend', 'overstay', 'monthly', 'valet'));

-- Destinations people type (areas, malls, hospitals, stadiums, offices). Seed coordinates are approximate.
CREATE TABLE destinations (
  id    serial PRIMARY KEY,
  name  text NOT NULL UNIQUE,
  kind  text NOT NULL CHECK (kind IN ('area', 'mall', 'hospital', 'stadium', 'office', 'airport', 'metro')),
  city  text NOT NULL DEFAULT 'Bengaluru',
  geo   geography(Point, 4326) NOT NULL
);
CREATE INDEX destinations_name_idx ON destinations (lower(name) text_pattern_ops);
INSERT INTO destinations (name, kind, geo) VALUES
  ('MG Road', 'area', ST_MakePoint(77.6066, 12.9756)::geography),
  ('Indiranagar', 'area', ST_MakePoint(77.6408, 12.9784)::geography),
  ('Koramangala', 'area', ST_MakePoint(77.6245, 12.9352)::geography),
  ('Whitefield', 'area', ST_MakePoint(77.7500, 12.9698)::geography),
  ('Hebbal', 'area', ST_MakePoint(77.5970, 13.0358)::geography),
  ('UB City', 'mall', ST_MakePoint(77.5960, 12.9716)::geography),
  ('Forum Mall, Koramangala', 'mall', ST_MakePoint(77.6112, 12.9345)::geography),
  ('Phoenix Marketcity, Whitefield', 'mall', ST_MakePoint(77.6966, 12.9976)::geography),
  ('Chinnaswamy Stadium', 'stadium', ST_MakePoint(77.5996, 12.9788)::geography),
  ('Manyata Tech Park', 'office', ST_MakePoint(77.6200, 13.0475)::geography),
  ('Kempegowda Airport', 'airport', ST_MakePoint(77.7066, 13.1986)::geography);

-- Account preferences (ACC-01) and data export requests (ACC-02).
ALTER TABLE users
  ADD COLUMN alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'kn', 'hi'));
CREATE TABLE data_export_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz
);
