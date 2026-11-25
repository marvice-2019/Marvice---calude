-- 003_templates.sql — WhatsApp message templates (needed to message outside the 24-hour window).

CREATE TABLE message_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waba_account_id   uuid NOT NULL REFERENCES waba_accounts(id) ON DELETE CASCADE,
  meta_template_id  text,
  name              text NOT NULL CHECK (name ~ '^[a-z0-9_]+$' AND length(name) <= 512),
  language          text NOT NULL,
  category          text NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  components        jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','PAUSED','DISABLED','DRAFT')),
  rejected_reason   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, waba_account_id, name, language)
);
CREATE INDEX message_templates_meta_idx ON message_templates (meta_template_id);

CREATE TRIGGER message_templates_updated_at BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_templates
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO app_tenant;
