CREATE TABLE affiliate_program_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_commission_rate numeric(7,4) NOT NULL DEFAULT 10 CHECK (default_commission_rate >= 0 AND default_commission_rate <= 100),
  minimum_payout numeric(12,2) NOT NULL DEFAULT 50 CHECK (minimum_payout >= 0),
  approval_hold_days integer NOT NULL DEFAULT 14 CHECK (approval_hold_days >= 0 AND approval_hold_days <= 365),
  currency char(3) NOT NULL DEFAULT 'USD',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO affiliate_program_settings (singleton) VALUES (true);

CREATE TABLE affiliate_profiles (
  id uuid PRIMARY KEY,
  wp_user_id bigint UNIQUE,
  email varchar(320) NOT NULL,
  username varchar(160) NOT NULL DEFAULT '',
  display_name varchar(200) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending_invite' CHECK (status IN ('pending_invite', 'active', 'suspended', 'closed')),
  password_hash text,
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  legacy_sales numeric(14,2) NOT NULL DEFAULT 0 CHECK (legacy_sales >= 0),
  legacy_commission numeric(14,2) NOT NULL DEFAULT 0 CHECK (legacy_commission >= 0),
  legacy_available numeric(14,2) NOT NULL DEFAULT 0 CHECK (legacy_available >= 0),
  legacy_pending_payout numeric(14,2) NOT NULL DEFAULT 0 CHECK (legacy_pending_payout >= 0),
  source varchar(40) NOT NULL DEFAULT 'phaseone',
  joined_at timestamptz,
  last_login_at timestamptz,
  legacy_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliate_profiles_email_unique ON affiliate_profiles (lower(email));
CREATE INDEX affiliate_profiles_status_idx ON affiliate_profiles (status, updated_at DESC);

CREATE TABLE affiliate_coupons (
  id uuid PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES affiliate_profiles(id),
  wp_coupon_id bigint UNIQUE,
  code varchar(120) NOT NULL,
  discount_type varchar(30) NOT NULL CHECK (discount_type IN ('percent', 'fixed_cart', 'fixed_product')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  commission_type varchar(20) NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'fixed')),
  commission_value numeric(12,4) NOT NULL DEFAULT 0 CHECK (commission_value >= 0),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired', 'archived')),
  referral_url text NOT NULL DEFAULT '',
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  legacy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliate_coupons_code_unique ON affiliate_coupons (lower(code));
CREATE INDEX affiliate_coupons_affiliate_idx ON affiliate_coupons (affiliate_id, status);

CREATE TABLE affiliate_commissions (
  id uuid PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES affiliate_profiles(id),
  coupon_id uuid NOT NULL REFERENCES affiliate_coupons(id),
  wc_order_id bigint NOT NULL,
  wc_order_number varchar(100) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  order_total numeric(14,2) NOT NULL DEFAULT 0,
  eligible_amount numeric(14,2) NOT NULL DEFAULT 0,
  commission_rate numeric(12,4) NOT NULL DEFAULT 0,
  commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL CHECK (status IN ('pending', 'approved', 'reserved', 'paid', 'reversed')),
  order_status varchar(40) NOT NULL,
  held_until timestamptz,
  approved_at timestamptz,
  reversed_at timestamptz,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wc_order_id, coupon_id)
);

CREATE INDEX affiliate_commissions_affiliate_idx ON affiliate_commissions (affiliate_id, status, created_at DESC);

CREATE TABLE affiliate_payout_requests (
  id uuid PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES affiliate_profiles(id),
  client_event_id uuid NOT NULL UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status varchar(24) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'processing', 'paid', 'rejected', 'cancelled')),
  payout_method varchar(40) NOT NULL,
  payout_destination varchar(320) NOT NULL,
  note varchar(500) NOT NULL DEFAULT '',
  external_reference varchar(180),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  reviewed_by varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_payouts_affiliate_idx ON affiliate_payout_requests (affiliate_id, requested_at DESC);
CREATE INDEX affiliate_payouts_status_idx ON affiliate_payout_requests (status, requested_at ASC);

CREATE TABLE affiliate_invitations (
  id uuid PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  token_digest char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_invitations_affiliate_idx ON affiliate_invitations (affiliate_id, created_at DESC);

CREATE TABLE affiliate_audit_events (
  id uuid PRIMARY KEY,
  affiliate_id uuid REFERENCES affiliate_profiles(id),
  payout_id uuid REFERENCES affiliate_payout_requests(id),
  event_type varchar(60) NOT NULL,
  actor_type varchar(20) NOT NULL CHECK (actor_type IN ('system', 'admin', 'affiliate')),
  actor_id varchar(160) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_audit_affiliate_idx ON affiliate_audit_events (affiliate_id, created_at DESC);
CREATE INDEX affiliate_audit_payout_idx ON affiliate_audit_events (payout_id, created_at DESC) WHERE payout_id IS NOT NULL;
