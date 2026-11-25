-- 011_pipelines.sql — sales pipelines (kanban) with deals linked to contacts.

CREATE TABLE pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  stages      jsonb NOT NULL,        -- [{id, name}] in board order
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id    uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id       text NOT NULL,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  value_paise    bigint NOT NULL DEFAULT 0 CHECK (value_paise >= 0),
  owner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  position       double precision NOT NULL DEFAULT 0,   -- order within a stage
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deals_board_idx ON deals (tenant_id, pipeline_id, stage_id, position);
CREATE INDEX deals_contact_idx ON deals (tenant_id, contact_id);

CREATE TRIGGER pipelines_updated_at BEFORE UPDATE ON pipelines FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deals_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pipelines','deals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
