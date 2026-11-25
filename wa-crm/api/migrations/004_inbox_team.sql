-- 004_inbox_team.sql — conversation notes, contact tags, auto-assignment setting.

ALTER TABLE tenants ADD COLUMN auto_assign boolean NOT NULL DEFAULT false;

CREATE TABLE conversation_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_notes_conv_idx ON conversation_notes (tenant_id, conversation_id, created_at);

CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  color       text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_label_uq ON tags (tenant_id, lower(label));

CREATE TABLE contact_tags (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX contact_tags_tag_idx ON contact_tags (tenant_id, tag_id);

CREATE INDEX conversations_assignee_idx ON conversations (tenant_id, assigned_user_id) WHERE status = 'open';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_notes','tags','contact_tags'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;

-- Picks the agent with the fewest open assigned conversations (ties: longest-standing member).
-- SECURITY DEFINER: tenant sessions may not read memberships directly.
CREATE FUNCTION pick_round_robin_agent() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id
    FROM memberships m
   WHERE m.tenant_id = app_current_tenant() AND m.role = 'agent'
   ORDER BY (SELECT count(*) FROM conversations c
              WHERE c.tenant_id = m.tenant_id AND c.assigned_user_id = m.user_id AND c.status = 'open'),
            m.created_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION pick_round_robin_agent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pick_round_robin_agent() TO app_tenant;

-- Is this user a member of the current tenant? (Used to validate assignment targets.)
CREATE FUNCTION is_tenant_member(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM memberships WHERE tenant_id = app_current_tenant() AND user_id = p_user)
$$;
REVOKE ALL ON FUNCTION is_tenant_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_tenant_member(uuid) TO app_tenant;
