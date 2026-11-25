-- 006_admin.sql — indexes for the platform (super-admin) API. No new tables.

-- "Is any tenant on this plan?" before deactivating it, and tenants-per-plan counts.
CREATE INDEX tenants_plan_idx ON tenants (plan_id);

-- Platform-wide audit log, newest first (the tenant filter uses audit_logs_tenant_idx).
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- Messages in the last 30 days across all tenants. BRIN: rows arrive roughly in time order,
-- so this stays tiny and costs almost nothing on the hot insert path.
CREATE INDEX messages_created_brin ON messages USING brin (created_at);
