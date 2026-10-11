-- Bayline parking marketplace: core data model (PostgreSQL 16 + PostGIS)
-- Covers: drivers, vehicles, operators and lots, rates, hourly bookings with
-- capacity control, payments (Razorpay), monthly passes, gate entry/exit, payouts.
-- Run: psql "$DATABASE_URL" -f schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- people and roles ----------
CREATE TYPE user_role AS ENUM ('driver', 'operator_admin', 'operator_staff', 'platform_admin');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         varchar(15) UNIQUE NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email         citext UNIQUE,
  full_name     text,
  role          user_role NOT NULL DEFAULT 'driver',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz            -- soft delete for DPDP Act erasure requests
);

CREATE TYPE vehicle_kind AS ENUM ('car', 'bike', 'ev_car', 'suv');

CREATE TABLE vehicles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate         varchar(16) NOT NULL CHECK (plate ~ '^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$'),
  kind          vehicle_kind NOT NULL DEFAULT 'car',
  nickname      text,
  UNIQUE (user_id, plate)
);

-- ---------- supply side ----------
CREATE TABLE operators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text NOT NULL,
  gstin           varchar(15) CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan             varchar(10) NOT NULL CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  commission_bps  int NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 5000), -- 1500 = 15%
  payout_account  jsonb,     -- Razorpay Route linked-account id; never store raw bank numbers here
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operator_members (
  operator_id   uuid REFERENCES operators(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  role          user_role NOT NULL CHECK (role IN ('operator_admin', 'operator_staff')),
  PRIMARY KEY (operator_id, user_id)
);

CREATE TYPE lot_kind AS ENUM ('multilevel', 'basement', 'surface', 'covered_deck', 'owner_listed');

CREATE TABLE lots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES operators(id),
  name           text NOT NULL,
  address        text NOT NULL,
  city           text NOT NULL,
  geo            geography(Point, 4326) NOT NULL,
  kind           lot_kind NOT NULL,
  capacity_car   int NOT NULL DEFAULT 0 CHECK (capacity_car >= 0),
  capacity_bike  int NOT NULL DEFAULT 0 CHECK (capacity_bike >= 0),
  online_share   numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (online_share BETWEEN 0 AND 1), -- share of capacity sold online
  covered        boolean NOT NULL DEFAULT false,
  ev_chargers    int NOT NULL DEFAULT 0,
  open_24h       boolean NOT NULL DEFAULT false,
  opens_at       time,
  closes_at      time,
  entry_method   text NOT NULL DEFAULT 'qr' CHECK (entry_method IN ('qr', 'anpr', 'attendant')),
  is_live        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lots_geo_idx  ON lots USING gist (geo);
CREATE INDEX lots_city_idx ON lots (city) WHERE is_live;

CREATE TABLE lot_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  vehicle        vehicle_kind NOT NULL,
  hourly_paise   int NOT NULL CHECK (hourly_paise > 0),        -- all money in paise
  daily_cap_paise int,
  monthly_paise  int,
  valid          tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  EXCLUDE USING gist (lot_id WITH =, vehicle WITH =, valid WITH &&)  -- no overlapping rate cards
);

-- ---------- bookings ----------
CREATE TYPE booking_status AS ENUM ('pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');

CREATE TABLE bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(8) UNIQUE NOT NULL,                   -- shown on pass, e.g. BL-7Q3K9
  user_id        uuid NOT NULL REFERENCES users(id),
  lot_id         uuid NOT NULL REFERENCES lots(id),
  vehicle_id     uuid NOT NULL REFERENCES vehicles(id),
  vehicle        vehicle_kind NOT NULL,
  period         tstzrange NOT NULL CHECK (upper(period) > lower(period)),
  status         booking_status NOT NULL DEFAULT 'pending_payment',
  base_paise     int NOT NULL,
  discount_paise int NOT NULL DEFAULT 0 CHECK (discount_paise >= 0 AND discount_paise <= base_paise),
  promo_code     varchar(20),                                  -- FK added after promo_codes is created
  source         text NOT NULL DEFAULT 'prebook' CHECK (source IN ('prebook', 'park_now', 'monthly')),
  fee_paise      int NOT NULL,
  gst_paise      int NOT NULL,
  total_paise    int GENERATED ALWAYS AS (base_paise - discount_paise + fee_paise + gst_paise) STORED,
  hold_expires_at timestamptz,                                 -- unpaid holds release after 10 min
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_lot_period_idx ON bookings USING gist (lot_id, period)
  WHERE status IN ('pending_payment', 'confirmed', 'checked_in');
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);

-- Capacity-safe booking: locks the lot row so two drivers cannot take the last bay.
CREATE OR REPLACE FUNCTION book_bay(
  p_user uuid, p_lot uuid, p_vehicle_id uuid, p_vehicle vehicle_kind,
  p_period tstzrange, p_base int, p_fee int, p_gst int
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_cap int; v_used int; v_id uuid;
BEGIN
  SELECT floor(CASE WHEN p_vehicle = 'bike' THEN capacity_bike ELSE capacity_car END * online_share)
    INTO v_cap FROM lots WHERE id = p_lot AND is_live FOR UPDATE;
  IF v_cap IS NULL THEN RAISE EXCEPTION 'lot_not_available'; END IF;

  SELECT count(*) INTO v_used FROM bookings
   WHERE lot_id = p_lot AND period && p_period
     AND (vehicle = 'bike') = (p_vehicle = 'bike')
     AND (status IN ('confirmed', 'checked_in')
          OR (status = 'pending_payment' AND hold_expires_at > now()));
  IF v_used >= v_cap THEN RAISE EXCEPTION 'lot_full'; END IF;

  INSERT INTO bookings (code, user_id, lot_id, vehicle_id, vehicle, period, base_paise, fee_paise, gst_paise, hold_expires_at)
  VALUES ('BL-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 5)), p_user, p_lot, p_vehicle_id, p_vehicle,
          p_period, p_base, p_fee, p_gst, now() + interval '10 minutes')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------- promo codes and favourites ----------
CREATE TABLE promo_codes (
  code            varchar(20) PRIMARY KEY CHECK (code = upper(code)),
  percent_off     smallint NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  max_off_paise   int NOT NULL CHECK (max_off_paise > 0),
  first_booking_only boolean NOT NULL DEFAULT false,
  weekend_only    boolean NOT NULL DEFAULT false,
  valid           tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  max_uses        int,                          -- NULL = unlimited
  used_count      int NOT NULL DEFAULT 0
);
-- Discount applies to parking (base) before GST; the platform fee is never discounted.
ALTER TABLE bookings ADD CONSTRAINT bookings_promo_fk FOREIGN KEY (promo_code) REFERENCES promo_codes(code);

CREATE TABLE favourite_lots (
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  lot_id     uuid REFERENCES lots(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lot_id)
);

-- Drive-up "Park now": each lot has a short code printed on its entrance board.
ALTER TABLE lots ADD COLUMN code varchar(10) UNIQUE CHECK (code ~ '^[A-Z]{3}[0-9]{3,4}$');

-- ---------- where I parked (on any booking or monthly pass) ----------
CREATE TABLE parked_spots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid REFERENCES bookings(id) ON DELETE CASCADE,
  monthly_pass_id uuid,                                  -- FK added after monthly_passes
  floor           varchar(6),
  bay             varchar(8),
  note            varchar(80),
  photo_url       text,                                  -- object storage key, never inline image data
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(booking_id, monthly_pass_id) = 1),
  CHECK (num_nonnulls(floor, bay, note, photo_url) >= 1)
);

-- ---------- valet ----------
CREATE TABLE valet_desks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  lot_id          uuid REFERENCES lots(id),              -- where cars are parked; NULL if the venue's own basement
  name            text NOT NULL,                         -- e.g. "UB City Mall entrance"
  geo             geography(Point, 4326) NOT NULL,
  fee_paise       int NOT NULL CHECK (fee_paise >= 0),   -- flat per visit, GST extra
  typical_eta_min smallint NOT NULL DEFAULT 6,
  is_live         boolean NOT NULL DEFAULT false
);

-- Venue validation: a restaurant/mall/hospital pays the valet fee for its guests.
CREATE TABLE valet_validations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id      uuid NOT NULL REFERENCES valet_desks(id),
  validator    text NOT NULL,                             -- "UB City restaurants"
  code         varchar(12) NOT NULL,
  valid        tstzrange NOT NULL,                        -- rotate daily so codes don't leak
  billed_to_operator_id uuid REFERENCES operators(id),   -- who is invoiced for validated visits
  UNIQUE (desk_id, code, valid)
);

CREATE TYPE valet_status AS ENUM ('dropped', 'parked', 'requested', 'coming', 'ready', 'closed', 'cancelled');

CREATE TABLE valet_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(8) UNIQUE NOT NULL,             -- VT-XXXX shown to the driver
  desk_id         uuid NOT NULL REFERENCES valet_desks(id),
  user_id         uuid NOT NULL REFERENCES users(id),     -- phone-verified driver (guest allowed)
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  key_tag         varchar(8) NOT NULL,
  bay             varchar(12),
  status          valet_status NOT NULL DEFAULT 'dropped',
  handover_photos jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 4 object keys: front, rear, left, right
  dropped_by      uuid REFERENCES users(id),              -- valet staff
  retrieved_by    uuid REFERENCES users(id),
  validation_id   uuid REFERENCES valet_validations(id),
  fee_paise       int NOT NULL,
  gst_paise       int NOT NULL DEFAULT 0,
  tip_paise       int NOT NULL DEFAULT 0 CHECK (tip_paise >= 0),   -- 100% to the valet; outside GST (confirm with CA)
  dropped_at      timestamptz NOT NULL DEFAULT now(),
  requested_at    timestamptz,
  ready_at        timestamptz,
  closed_at       timestamptz,
  damage_report   jsonb,                                  -- {where, photo_url, reported_at}
  CHECK (jsonb_typeof(handover_photos) = 'array')
);
-- A key tag can hang on only one open ticket per desk: the fraud guard for lost or swapped keys.
CREATE UNIQUE INDEX valet_open_tag_uq ON valet_tickets (desk_id, key_tag) WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX valet_queue_idx ON valet_tickets (desk_id, status, requested_at) WHERE status IN ('requested', 'coming');

-- ---------- money ----------
CREATE TYPE payment_status AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid REFERENCES bookings(id),
  monthly_pass_id    uuid,
  razorpay_order_id  text UNIQUE NOT NULL,
  razorpay_payment_id text UNIQUE,
  amount_paise       int NOT NULL,
  gateway_fee_paise  int,              -- Razorpay fee + its GST, kept separate for P&L
  method             text,             -- upi | card | netbanking | wallet
  status             payment_status NOT NULL DEFAULT 'created',
  raw_webhook        jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(booking_id, monthly_pass_id) = 1)
);

CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text UNIQUE NOT NULL,          -- GST series, e.g. BL/2026-27/000123
  payment_id    uuid NOT NULL REFERENCES payments(id),
  taxable_paise int NOT NULL,
  cgst_paise    int NOT NULL DEFAULT 0,
  sgst_paise    int NOT NULL DEFAULT 0,
  igst_paise    int NOT NULL DEFAULT 0,
  sac_code      varchar(6) NOT NULL DEFAULT '996743',  -- parking services; confirm with CA
  pdf_url       text,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- monthly passes ----------
CREATE TYPE pass_status AS ENUM ('requested', 'approved', 'active', 'paused_unpaid', 'cancelled');

CREATE TABLE monthly_passes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  lot_id       uuid NOT NULL REFERENCES lots(id),
  vehicle_id   uuid NOT NULL REFERENCES vehicles(id),
  status       pass_status NOT NULL DEFAULT 'requested',
  starts_on    date NOT NULL,
  price_paise  int NOT NULL,
  due_day      smallint NOT NULL DEFAULT 5,     -- due by the 5th, entry blocked after the 7th if unpaid
  bay_label    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD CONSTRAINT payments_monthly_fk FOREIGN KEY (monthly_pass_id) REFERENCES monthly_passes(id);
ALTER TABLE parked_spots ADD CONSTRAINT parked_spots_monthly_fk FOREIGN KEY (monthly_pass_id) REFERENCES monthly_passes(id) ON DELETE CASCADE;
-- Valet payments: one payment row per ticket, raised when the driver requests the car.
ALTER TABLE payments ADD COLUMN valet_ticket_id uuid REFERENCES valet_tickets(id);
ALTER TABLE payments DROP CONSTRAINT payments_check;
ALTER TABLE payments ADD CONSTRAINT payments_one_target CHECK (num_nonnulls(booking_id, monthly_pass_id, valet_ticket_id) = 1);

-- ---------- gate events (QR scan or ANPR camera) ----------
CREATE TABLE gate_events (
  id           bigserial PRIMARY KEY,
  lot_id       uuid NOT NULL REFERENCES lots(id),
  booking_id   uuid REFERENCES bookings(id),
  monthly_pass_id uuid REFERENCES monthly_passes(id),
  plate_read   varchar(16),
  direction    text NOT NULL CHECK (direction IN ('in', 'out')),
  scanned_by   uuid REFERENCES users(id),
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gate_events_lot_at_idx ON gate_events (lot_id, at DESC);

-- ---------- operator payouts ----------
CREATE TABLE payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES operators(id),
  period           daterange NOT NULL,
  gross_paise      bigint NOT NULL,
  commission_paise bigint NOT NULL,
  tds_paise        bigint NOT NULL DEFAULT 0,    -- TCS/TDS under GST and Income Tax rules for e-commerce operators; confirm with CA
  net_paise        bigint GENERATED ALWAYS AS (gross_paise - commission_paise - tds_paise) STORED,
  razorpay_transfer_id text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  UNIQUE (operator_id, period)
);

-- ---------- search query used by the app ----------
-- Lots within 3 km of a point, nearest first, with the rate card active at arrival:
-- SELECT l.id, l.name, ST_Distance(l.geo, ST_MakePoint($lng, $lat)::geography) AS metres, r.hourly_paise
--   FROM lots l JOIN lot_rates r ON r.lot_id = l.id AND r.vehicle = $vehicle AND r.valid @> $arrive::timestamptz
--  WHERE l.is_live AND ST_DWithin(l.geo, ST_MakePoint($lng, $lat)::geography, 3000)
--  ORDER BY metres LIMIT 30;
