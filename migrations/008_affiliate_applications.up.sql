CREATE TABLE affiliate_applications (
  id uuid PRIMARY KEY,
  client_event_id uuid NOT NULL UNIQUE,
  wp_user_id bigint,
  email varchar(320) NOT NULL,
  display_name varchar(200) NOT NULL,
  preferred_coupon varchar(24) NOT NULL,
  platform varchar(60) NOT NULL,
  social_handle varchar(240) NOT NULL,
  audience_size varchar(60) NOT NULL,
  promotion_notes text NOT NULL,
  source varchar(40) NOT NULL CHECK (source IN ('public_form', 'account_form')),
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  confirmations jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by varchar(160),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliate_applications_open_email_unique
  ON affiliate_applications (lower(email))
  WHERE status = 'pending';

CREATE INDEX affiliate_applications_status_idx
  ON affiliate_applications (status, created_at DESC);

CREATE INDEX affiliate_applications_wp_user_idx
  ON affiliate_applications (wp_user_id, created_at DESC)
  WHERE wp_user_id IS NOT NULL;

