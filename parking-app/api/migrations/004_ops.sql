-- Stage 7: operator payouts with full tax lines, Route transfer lifecycle, audit queries.
-- Tax treatment (TDS 194-O, GST TCS s.52, GST on commission) is configurable and must be confirmed by a CA.

-- When money actually arrived; payouts group by this, not by order creation.
ALTER TABLE payments ADD COLUMN captured_at timestamptz;
UPDATE payments SET captured_at = created_at WHERE status IN ('captured', 'partially_refunded', 'refunded');
CREATE INDEX payments_captured_idx ON payments (captured_at) WHERE captured_at IS NOT NULL;

ALTER TABLE payouts DROP COLUMN net_paise;
ALTER TABLE payouts
  ADD COLUMN commission_gst_paise bigint NOT NULL DEFAULT 0,   -- 18% GST the platform charges on its commission
  ADD COLUMN tcs_paise            bigint NOT NULL DEFAULT 0,   -- GST TCS under s.52 (GST-registered operators only)
  ADD COLUMN payments_count       int NOT NULL DEFAULT 0,
  ADD COLUMN failure_reason       text,
  ADD COLUMN transferred_at       timestamptz,
  ADD COLUMN created_at           timestamptz NOT NULL DEFAULT now();
ALTER TABLE payouts ADD COLUMN net_paise bigint
  GENERATED ALWAYS AS (gross_paise - commission_paise - commission_gst_paise - tds_paise - tcs_paise) STORED;
ALTER TABLE payouts DROP CONSTRAINT payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check CHECK (status IN ('pending', 'processing', 'paid', 'failed'));
CREATE INDEX payouts_transfer_idx ON payouts (razorpay_transfer_id) WHERE razorpay_transfer_id IS NOT NULL;

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
