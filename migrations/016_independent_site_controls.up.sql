CREATE TABLE site_control_state (
  singleton smallint PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
  version varchar(24) NOT NULL,
  source varchar(48) NOT NULL DEFAULT 'operations-control-plane' CHECK (source = 'operations-control-plane'),
  revision bigint NOT NULL CHECK (revision >= 1),
  promo jsonb NOT NULL,
  maintenance jsonb NOT NULL,
  updated_by varchar(180) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_control_events (
  id bigserial PRIMARY KEY,
  revision bigint NOT NULL UNIQUE,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('seeded', 'published')),
  actor varchar(180) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX site_control_events_created_at_idx
  ON site_control_events (created_at DESC);
