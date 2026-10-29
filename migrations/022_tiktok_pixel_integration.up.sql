CREATE TABLE marketing_pixel_settings (
  provider varchar(32) PRIMARY KEY,
  version varchar(24) NOT NULL DEFAULT '1.0',
  source varchar(48) NOT NULL DEFAULT 'operations-control-plane',
  enabled boolean NOT NULL DEFAULT false,
  pixel_id varchar(64) NOT NULL DEFAULT '',
  events jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL CHECK (revision >= 1),
  updated_by varchar(180) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider = 'tiktok'),
  CHECK (source = 'operations-control-plane'),
  CHECK (enabled = false OR length(pixel_id) >= 8)
);

CREATE TABLE marketing_pixel_events (
  id bigserial PRIMARY KEY,
  provider varchar(32) NOT NULL REFERENCES marketing_pixel_settings(provider) ON DELETE CASCADE,
  revision bigint NOT NULL,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('seeded', 'updated')),
  actor varchar(180) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, revision)
);

CREATE INDEX marketing_pixel_events_created_at_idx
  ON marketing_pixel_events (created_at DESC);

INSERT INTO marketing_pixel_settings (
  provider, version, source, enabled, pixel_id, events, revision, updated_by
) VALUES (
  'tiktok',
  '1.0',
  'operations-control-plane',
  true,
  'D9UBLSRC77UDKVSV1D90',
  '{"pageView":true,"viewContent":true,"search":true,"addToCart":true,"initiateCheckout":true,"purchase":true}'::jsonb,
  1,
  'system:migrated-hardcoded-pixel'
);

INSERT INTO marketing_pixel_events (provider, revision, event_type, actor, payload)
SELECT provider, revision, 'seeded', updated_by, to_jsonb(marketing_pixel_settings)
  FROM marketing_pixel_settings
 WHERE provider = 'tiktok';
