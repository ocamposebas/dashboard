DROP INDEX IF EXISTS affiliate_commissions_order_status_idx;

ALTER TABLE affiliate_coupons
  DROP COLUMN IF EXISTS shadow_baseline_commission,
  DROP COLUMN IF EXISTS shadow_baseline_sales,
  DROP COLUMN IF EXISTS shadow_baseline_usage_count;

ALTER TABLE affiliate_program_settings
  DROP COLUMN IF EXISTS shadow_last_synced_at,
  DROP COLUMN IF EXISTS shadow_started_at,
  DROP COLUMN IF EXISTS shadow_mode_enabled;
