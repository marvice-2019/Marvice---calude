-- 005_billing.sql — plan limits, Razorpay subscriptions, GST invoices.

ALTER TABLE plans   ADD COLUMN razorpay_plan_id text UNIQUE;
ALTER TABLE tenants ADD COLUMN state_code text CHECK (state_code ~ '^[0-9]{2}$'),   -- GST state code, e.g. 29 = Karnataka
                    ADD COLUMN billing_name text,
                    ADD COLUMN billing_address text;

-- Limit check for the current tenant. SECURITY DEFINER so tenant sessions can read their own
-- plan and counts without being granted the platform tables (memberships would leak across tenants).
-- No row returned = no limit for that resource.
CREATE FUNCTION tenant_limit_usage(p_resource text)
RETURNS TABLE (max_value integer, used bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.max_value,
         CASE p_resource
           WHEN 'contacts'         THEN (SELECT count(*) FROM contacts      WHERE tenant_id = t.id)
           WHEN 'agents'           THEN (SELECT count(*) FROM memberships   WHERE tenant_id = t.id AND role IN ('admin','agent'))
           WHEN 'whatsapp_numbers' THEN (SELECT count(*) FROM phone_numbers WHERE tenant_id = t.id)
         END
    FROM tenants t
    JOIN plan_limits pl ON pl.plan_id = t.plan_id AND pl.resource = p_resource
   WHERE t.id = app_current_tenant()
$$;
REVOKE ALL ON FUNCTION tenant_limit_usage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_limit_usage(text) TO app_tenant;

CREATE TABLE subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                   uuid NOT NULL REFERENCES plans(id),
  razorpay_subscription_id  text NOT NULL UNIQUE,
  status                    text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','authenticated','active','pending','halted','cancelled','completed')),
  short_url                 text,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id, created_at DESC);

-- Gap-free invoice numbers per Indian financial year (April–March).
CREATE TABLE invoice_counters (
  fy       text PRIMARY KEY,           -- e.g. 2026-27
  last_no  integer NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id        uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  number                 text NOT NULL UNIQUE,
  period_start           timestamptz,
  period_end             timestamptz,
  taxable_paise          integer NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise             integer NOT NULL DEFAULT 0,
  sgst_paise             integer NOT NULL DEFAULT 0,
  igst_paise             integer NOT NULL DEFAULT 0,
  total_paise            integer NOT NULL,
  place_of_supply_state  text NOT NULL,
  customer_gstin         text,
  customer_name          text,
  razorpay_payment_id    text NOT NULL UNIQUE,      -- one invoice per payment; webhook replays are no-ops
  status                 text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','void')),
  issued_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (taxable_paise + cgst_paise + sgst_paise + igst_paise = total_paise)
);
CREATE INDEX invoices_tenant_idx ON invoices (tenant_id, issued_at DESC);

CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','invoices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_tenant', t);
  END LOOP;
END $$;

-- Tenant pages show plan names and prices.
GRANT SELECT ON plans TO app_tenant;
