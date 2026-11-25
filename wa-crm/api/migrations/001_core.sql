-- 001_core.sql — tenants, users, WhatsApp numbers, contacts, conversations, messages.
--
-- Tenant isolation: every tenant-owned table has tenant_id and a row-level security
-- policy. The API runs tenant work inside a transaction that does
--   SET LOCAL ROLE app_tenant; SET LOCAL app.tenant_id = '<uuid>';
-- so a query can only ever see that tenant's rows. With no tenant set, it sees nothing.
-- Platform tables (tenants, users, memberships, plans) are read by the API's owner
-- connection only, for login and webhook routing.

CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN;
  END IF;
END $$;

-- Lets the owner connection switch into app_tenant inside a transaction.
GRANT app_tenant TO CURRENT_USER;

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------- Platform ----------

CREATE TABLE plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  price_paise   integer NOT NULL CHECK (price_paise >= 0),      -- before GST
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per limit, so a new limit needs no schema change.
CREATE TABLE plan_limits (
  plan_id   uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  resource  text NOT NULL,          -- e.g. contacts, agents, campaigns_per_month
  max_value integer NOT NULL CHECK (max_value >= 0),
  PRIMARY KEY (plan_id, resource)
);

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  plan_id     uuid REFERENCES plans(id),
  gstin       text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','agent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- ---------- WhatsApp accounts ----------

CREATE TABLE waba_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meta_waba_id        text NOT NULL UNIQUE,
  name                text,
  access_token_enc    text NOT NULL,        -- AES-256-GCM, never returned by the API
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waba_accounts_tenant_idx ON waba_accounts (tenant_id);

CREATE TABLE phone_numbers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waba_account_id      uuid NOT NULL REFERENCES waba_accounts(id) ON DELETE CASCADE,
  meta_phone_number_id text NOT NULL UNIQUE,   -- webhook routing key
  display_phone        text NOT NULL,
  verified_name        text,
  quality_rating       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_numbers_tenant_idx ON phone_numbers (tenant_id);

-- ---------- Contacts ----------

CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_e164    text NOT NULL CHECK (phone_e164 ~ '^[1-9][0-9]{7,14}$'),  -- digits only, no +
  name          text,
  email         citext,
  status        text NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','prospect','customer','inactive')),
  opted_in_at   timestamptz,
  opt_in_source text,
  opted_out_at  timestamptz,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_e164)
);

-- ---------- Inbox ----------

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id  uuid NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at  timestamptz,
  last_inbound_at  timestamptz,   -- the 24-hour customer-service window starts here
  unread_count     integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_number_id, contact_id)
);
CREATE INDEX conversations_inbox_idx ON conversations (tenant_id, last_message_at DESC);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction        text NOT NULL CHECK (direction IN ('inbound','outbound')),
  type             text NOT NULL,                 -- text, image, document, template, ...
  body             text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  wa_message_id    text,                          -- Meta's wamid; dedupes webhook retries
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','delivered','read','failed','received')),
  error_code       text,
  sent_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messages_wamid_uq ON messages (tenant_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX messages_conversation_idx ON messages (tenant_id, conversation_id, created_at);

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target      text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC);

-- ---------- updated_at triggers ----------

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['plans','tenants','users','waba_accounts','phone_numbers',
                           'contacts','conversations','messages'] LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------- Row-level security on tenant tables ----------

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['waba_accounts','phone_numbers','contacts','conversations',
                           'messages','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_tenant;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
-- Agents' names show in the inbox; tenant code may read users but never their hashes.
GRANT SELECT (id, name, email) ON users TO app_tenant;
