-- 007_campaigns.sql — broadcast campaigns sent with approved templates.

CREATE TABLE campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone_number_id  uuid NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  template_id      uuid NOT NULL REFERENCES message_templates(id),
  parameters       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- strings; may contain {{contact.name}} / {{contact.phone}}
  audience         jsonb NOT NULL,                        -- {type: all|tags|contacts, tagIds?, contactIds?}
  status           text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','sending','completed','cancelled')),
  scheduled_at     timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_tenant_idx ON campaigns (tenant_id, created_at DESC);

-- One row per contact. 'sending' is held only while a request to Meta is in flight;
-- a row stuck there after a crash is marked failed, never re-sent (no duplicate marketing messages).
CREATE TABLE campaign_recipients (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  message_id   uuid REFERENCES messages(id) ON DELETE SET NULL,
  error_code   text,
  claimed_at   timestamptz,
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX campaign_recipients_pending_idx ON campaign_recipients (campaign_id, id) WHERE status = 'pending';

-- Delivery and read stats come from the messages themselves (updated by the status webhook).
ALTER TABLE messages ADD COLUMN campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX messages_campaign_idx ON messages (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['campaigns','campaign_recipients'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;

-- Tenant transactions enqueue work in the same commit as the data it refers to, through this
-- function only (no direct access to jobs). Inside a tenant session the job's tenant is forced
-- to the session's tenant, whatever the caller passed.
CREATE FUNCTION enqueue_job(p_queue text, p_tenant uuid, p_payload jsonb, p_run_at timestamptz,
                            p_max_attempts integer, p_dedupe_key text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id bigint;
  v_tenant uuid := coalesce(app_current_tenant(), p_tenant);
BEGIN
  INSERT INTO jobs (queue, tenant_id, payload, run_at, max_attempts, dedupe_key)
  VALUES (p_queue, v_tenant, p_payload, coalesce(p_run_at, now()), p_max_attempts, p_dedupe_key)
  ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running') DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION enqueue_job(text, uuid, jsonb, timestamptz, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_job(text, uuid, jsonb, timestamptz, integer, text) TO app_tenant;
