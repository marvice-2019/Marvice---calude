-- API support tables and columns on top of 001_init (schema.sql).

-- Auth
CREATE TABLE otp_codes (
  id          bigserial PRIMARY KEY,
  phone       varchar(15) NOT NULL,
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE refresh_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

-- Driver preferences (DRV-07)
ALTER TABLE users
  ADD COLUMN default_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN payment_method text CHECK (payment_method IN ('upi', 'card', 'netbanking'));

-- Lot status (OPS-04)
ALTER TABLE lots ADD COLUMN status text NOT NULL DEFAULT 'open'
  CHECK (status IN ('open', 'full', 'gate_down', 'closed'));

-- Payments: what each payment is for, and refunds
ALTER TABLE payments
  ADD COLUMN purpose text NOT NULL DEFAULT 'booking' CHECK (purpose IN ('booking', 'extend', 'overstay', 'monthly')),
  ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN refunded_paise int NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0);
ALTER TABLE payments ALTER COLUMN razorpay_order_id DROP NOT NULL;
CREATE INDEX payments_booking_idx ON payments (booking_id);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments(id),
  amount_paise       int NOT NULL CHECK (amount_paise > 0),
  razorpay_refund_id text,
  reason             text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Webhook and request idempotency
CREATE TABLE webhook_events (
  event_id     text PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE idempotency_keys (
  user_id     uuid NOT NULL,
  key         text NOT NULL,
  route       text NOT NULL,
  response    jsonb NOT NULL,
  status_code int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key, route)
);

-- Gate events: offline scans are retried, so each carries a client id
ALTER TABLE gate_events ADD COLUMN client_event_id text UNIQUE;

-- GST invoice numbering (BL/2026-27/000001)
CREATE SEQUENCE invoice_seq;

-- Audit log for operator and admin writes
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);

-- Lot-owner leads (OWN-01, proposed in SPEC)
CREATE TABLE owner_leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      varchar(15) NOT NULL,
  address    text NOT NULL,
  bays       int NOT NULL CHECK (bays > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Monthly pass: one captured payment per pass per month (meta.month = 'YYYY-MM')
CREATE UNIQUE INDEX payments_monthly_month_uq ON payments (monthly_pass_id, (meta->>'month'))
  WHERE purpose = 'monthly' AND status = 'captured';
