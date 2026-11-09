CREATE TABLE bulk_order_settings (
  singleton smallint PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  global_discount numeric(6,2) NOT NULL DEFAULT 50 CHECK (global_discount >= 0 AND global_discount < 100),
  default_minimum integer NOT NULL DEFAULT 10 CHECK (default_minimum >= 10 AND default_minimum % 10 = 0),
  session_days integer NOT NULL DEFAULT 14 CHECK (session_days BETWEEN 1 AND 3650),
  intent_minutes integer NOT NULL DEFAULT 720 CHECK (intent_minutes BETWEEN 5 AND 1440),
  public_title varchar(160) NOT NULL DEFAULT 'Bulk Orders',
  public_intro text NOT NULL DEFAULT 'Approved customers receive access to private bulk pricing.',
  catalog_mode varchar(24) NOT NULL DEFAULT 'include_all' CHECK (catalog_mode IN ('include_all', 'legacy_explicit')),
  excluded_category_ids integer[] NOT NULL DEFAULT '{}',
  excluded_product_ids integer[] NOT NULL DEFAULT '{}',
  updated_by varchar(180) NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bulk_order_settings (singleton) VALUES (1)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE bulk_product_rules (
  purchasable_id bigint PRIMARY KEY CHECK (purchasable_id > 0),
  product_id bigint NOT NULL CHECK (product_id > 0),
  variation_id bigint NOT NULL DEFAULT 0 CHECK (variation_id >= 0),
  catalog_override varchar(16) NOT NULL DEFAULT 'inherit' CHECK (catalog_override IN ('inherit', 'include', 'exclude')),
  availability_override varchar(16) NOT NULL DEFAULT 'inherit' CHECK (availability_override IN ('inherit', 'available', 'unavailable')),
  minimum_quantity integer NULL CHECK (minimum_quantity IS NULL OR (minimum_quantity >= 10 AND minimum_quantity % 10 = 0)),
  maximum_quantity integer NOT NULL DEFAULT 0 CHECK (maximum_quantity >= 0 AND maximum_quantity % 10 = 0),
  pricing_mode varchar(16) NOT NULL DEFAULT 'inherit' CHECK (pricing_mode IN ('inherit', 'discount', 'fixed', 'tiered')),
  discount_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  fixed_unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (fixed_unit_price >= 0),
  tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision char(64) NOT NULL,
  source varchar(24) NOT NULL DEFAULT 'operations' CHECK (source IN ('operations', 'wordpress_import')),
  updated_by varchar(180) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bulk_product_rules_product_idx ON bulk_product_rules (product_id, variation_id);

CREATE TABLE bulk_customer_tiers (
  customer_id bigint PRIMARY KEY CHECK (customer_id > 0),
  customer_email varchar(320) NOT NULL DEFAULT '',
  customer_name varchar(190) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  note text NOT NULL DEFAULT '',
  granted_by varchar(180) NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by varchar(180) NULL,
  revoked_at timestamptz NULL
);

CREATE INDEX bulk_customer_tiers_status_idx ON bulk_customer_tiers (status, granted_at DESC);

CREATE TABLE bulk_access_requests (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL CHECK (customer_id > 0),
  customer_name varchar(190) NOT NULL,
  customer_email varchar(320) NOT NULL,
  completed_orders integer NOT NULL DEFAULT 0 CHECK (completed_orders >= 0),
  eligible boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
  customer_note text NOT NULL DEFAULT '',
  internal_note text NOT NULL DEFAULT '',
  reviewed_by varchar(180) NULL,
  reviewed_at timestamptz NULL,
  source varchar(24) NOT NULL DEFAULT 'operations' CHECK (source IN ('operations', 'wordpress_import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bulk_access_requests_one_pending_idx ON bulk_access_requests (customer_id) WHERE status = 'pending';
CREATE INDEX bulk_access_requests_status_idx ON bulk_access_requests (status, created_at DESC);

CREATE TABLE bulk_access_codes (
  id bigserial PRIMARY KEY,
  code_lookup char(64) NOT NULL UNIQUE,
  code_suffix varchar(12) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked', 'expired', 'legacy')),
  expires_at timestamptz NULL,
  usage_limit bigint NULL CHECK (usage_limit IS NULL OR usage_limit > 0),
  uses bigint NOT NULL DEFAULT 0 CHECK (uses >= 0),
  notes text NOT NULL DEFAULT '',
  created_by varchar(180) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  legacy_wordpress_id bigint NULL
);

CREATE INDEX bulk_access_codes_status_idx ON bulk_access_codes (status, created_at DESC);

CREATE TABLE bulk_sessions (
  id bigserial PRIMARY KEY,
  token_lookup char(64) NOT NULL UNIQUE,
  access_code_id bigint NULL REFERENCES bulk_access_codes(id) ON DELETE SET NULL,
  customer_id bigint NOT NULL DEFAULT 0 CHECK (customer_id >= 0),
  source varchar(16) NOT NULL CHECK (source IN ('code', 'tier')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  ip_hash char(64) NOT NULL DEFAULT '',
  user_agent_hash char(64) NOT NULL DEFAULT ''
);

CREATE INDEX bulk_sessions_customer_idx ON bulk_sessions (customer_id, source, expires_at DESC);
CREATE INDEX bulk_sessions_expiry_idx ON bulk_sessions (expires_at);

CREATE TABLE bulk_checkout_intents (
  id bigserial PRIMARY KEY,
  token_lookup char(64) NOT NULL UNIQUE,
  session_id bigint NOT NULL REFERENCES bulk_sessions(id) ON DELETE CASCADE,
  access_code_id bigint NULL REFERENCES bulk_access_codes(id) ON DELETE SET NULL,
  customer_id bigint NOT NULL DEFAULT 0 CHECK (customer_id >= 0),
  cart_payload jsonb NOT NULL,
  quote_payload jsonb NOT NULL,
  quote_fingerprint char(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'ordered', 'expired', 'cancelled')),
  order_id bigint NOT NULL DEFAULT 0 CHECK (order_id >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bulk_checkout_intents_status_idx ON bulk_checkout_intents (status, expires_at);
CREATE INDEX bulk_checkout_intents_order_idx ON bulk_checkout_intents (order_id) WHERE order_id > 0;

CREATE TABLE bulk_order_events (
  id bigserial PRIMARY KEY,
  event_type varchar(48) NOT NULL,
  actor varchar(180) NOT NULL,
  entity_type varchar(32) NOT NULL,
  entity_id varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bulk_order_events_created_idx ON bulk_order_events (created_at DESC);

CREATE TABLE bulk_wordpress_imports (
  source_key varchar(80) PRIMARY KEY,
  source_version varchar(32) NOT NULL DEFAULT '',
  payload_hash char(64) NOT NULL,
  imported_by varchar(180) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
