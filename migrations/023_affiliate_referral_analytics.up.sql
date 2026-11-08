CREATE TABLE affiliate_referral_clicks (
  id uuid PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  coupon_id uuid NOT NULL REFERENCES affiliate_coupons(id) ON DELETE CASCADE,
  visitor_hash char(64) NOT NULL,
  event_key char(64) NOT NULL UNIQUE,
  landing_path varchar(500) NOT NULL DEFAULT '/',
  referrer_host varchar(255) NOT NULL DEFAULT '',
  device_type varchar(20) NOT NULL DEFAULT 'unknown'
    CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_referral_clicks_affiliate_time_idx
  ON affiliate_referral_clicks (affiliate_id, occurred_at DESC);

CREATE INDEX affiliate_referral_clicks_coupon_time_idx
  ON affiliate_referral_clicks (coupon_id, occurred_at DESC);

CREATE INDEX affiliate_referral_clicks_affiliate_visitor_idx
  ON affiliate_referral_clicks (affiliate_id, visitor_hash);

CREATE INDEX affiliate_referral_clicks_affiliate_landing_idx
  ON affiliate_referral_clicks (affiliate_id, landing_path);

CREATE INDEX affiliate_referral_clicks_affiliate_referrer_idx
  ON affiliate_referral_clicks (affiliate_id, referrer_host);
