-- 008_automation.sql — chatbot flows, flow runs, working hours and away message.

CREATE TABLE flows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone_number_id  uuid REFERENCES phone_numbers(id) ON DELETE CASCADE,   -- NULL = every number
  trigger          jsonb NOT NULL,     -- {type: keyword|new_conversation|any_message, keywords?, match?}
  nodes            jsonb NOT NULL,     -- [{id, type, data}]
  edges            jsonb NOT NULL,     -- [{from, to, handle?}]
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flows_live_idx ON flows (tenant_id) WHERE status = 'published';

CREATE TABLE flow_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id          uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- A snapshot of the graph, so editing a flow never breaks runs already in progress.
  nodes            jsonb NOT NULL,
  edges            jsonb NOT NULL,
  current_node     text NOT NULL,
  vars             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','waiting_reply','waiting_timer','completed','failed','cancelled')),
  wait_token       uuid,               -- a timer job only acts if this still matches
  steps            integer NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- At most one active run per conversation.
CREATE UNIQUE INDEX flow_runs_active_uq ON flow_runs (conversation_id)
  WHERE status IN ('running','waiting_reply','waiting_timer');
CREATE INDEX flow_runs_flow_idx ON flow_runs (tenant_id, flow_id, created_at DESC);

CREATE TABLE inbox_settings (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
  hours              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"mon":[["09:00","18:00"]], ...}; missing day = closed
  away_enabled       boolean NOT NULL DEFAULT false,
  away_message       text CHECK (length(away_message) <= 1024),
  away_cooldown_min  integer NOT NULL DEFAULT 240 CHECK (away_cooldown_min BETWEEN 0 AND 10080),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversations ADD COLUMN away_sent_at timestamptz;

CREATE TRIGGER flows_updated_at BEFORE UPDATE ON flows FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER flow_runs_updated_at BEFORE UPDATE ON flow_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inbox_settings_updated_at BEFORE UPDATE ON inbox_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['flows','flow_runs','inbox_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
