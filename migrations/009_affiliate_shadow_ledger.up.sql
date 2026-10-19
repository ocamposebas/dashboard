ALTER TABLE affiliate_program_settings
  ADD COLUMN shadow_mode_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN shadow_started_at timestamptz,
  ADD COLUMN shadow_last_synced_at timestamptz;

ALTER TABLE affiliate_coupons
  ADD COLUMN shadow_baseline_usage_count integer,
  ADD COLUMN shadow_baseline_sales numeric(14,2),
  ADD COLUMN shadow_baseline_commission numeric(14,2);

CREATE INDEX affiliate_commissions_order_status_idx
  ON affiliate_commissions (wc_order_id, status, updated_at DESC);

