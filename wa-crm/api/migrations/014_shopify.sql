-- 014_shopify.sql — one Shopify store per workspace; products sync into the catalog.

CREATE TABLE shopify_connections (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  shop_domain     text NOT NULL CHECK (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  token_enc       text NOT NULL,
  shop_name       text,
  currency        text,
  last_synced_at  timestamptz,
  last_result     jsonb,               -- {ok, created, updated, hidden, error?}
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER shopify_connections_updated_at BEFORE UPDATE ON shopify_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE shopify_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shopify_connections
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON shopify_connections TO app_tenant;
