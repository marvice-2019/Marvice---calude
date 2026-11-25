-- 010_ai.sql — AI reply suggestions: per-tenant business context, usage log, monthly limit.

CREATE TABLE ai_settings (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  business_context  text NOT NULL DEFAULT '' CHECK (length(business_context) <= 4000),  -- what we sell, prices, hours, policies
  tone              text NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly','formal','short')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('suggest','rewrite')),
  input_tokens  integer,
  output_tokens integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_tenant_month_idx ON ai_requests (tenant_id, created_at);

CREATE TRIGGER ai_settings_updated_at BEFORE UPDATE ON ai_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_settings','ai_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;

-- Add the monthly AI limit to the usage function (calendar month, IST).
CREATE OR REPLACE FUNCTION tenant_limit_usage(p_resource text)
RETURNS TABLE (max_value integer, used bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.max_value,
         CASE p_resource
           WHEN 'contacts'         THEN (SELECT count(*) FROM contacts      WHERE tenant_id = t.id)
           WHEN 'agents'           THEN (SELECT count(*) FROM memberships   WHERE tenant_id = t.id AND role IN ('admin','agent'))
           WHEN 'whatsapp_numbers' THEN (SELECT count(*) FROM phone_numbers WHERE tenant_id = t.id)
           WHEN 'ai_replies_month' THEN (SELECT count(*) FROM ai_requests   WHERE tenant_id = t.id
                                          AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
         END
    FROM tenants t
    JOIN plan_limits pl ON pl.plan_id = t.plan_id AND pl.resource = p_resource
   WHERE t.id = app_current_tenant()
$$;
