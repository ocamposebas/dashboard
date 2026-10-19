CREATE TABLE product_locations (
  product_id bigint NOT NULL CHECK (product_id > 0),
  variation_id bigint NOT NULL DEFAULT 0 CHECK (variation_id >= 0),
  location_code varchar(20) NOT NULL CHECK (
    location_code = upper(location_code)
    AND location_code ~ '^[A-Z][A-Z0-9]*-[0-9]{2,3}$'
  ),
  updated_by varchar(100) NOT NULL CHECK (length(trim(updated_by)) > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, variation_id)
);

CREATE INDEX product_locations_location_code_idx
  ON product_locations (location_code);

CREATE TABLE order_fulfillments (
  id uuid PRIMARY KEY,
  order_id bigint NOT NULL UNIQUE CHECK (order_id > 0),
  order_number varchar(40) NOT NULL CHECK (length(trim(order_number)) > 0),
  state varchar(20) NOT NULL DEFAULT 'open' CHECK (
    state IN ('open', 'packed', 'cancelled')
  ),
  source_modified_at timestamptz,
  source_snapshot jsonb NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion_snapshot jsonb,
  started_by varchar(100) NOT NULL CHECK (length(trim(started_by)) > 0),
  cancelled_by varchar(100),
  cancel_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  packed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  wordpress_sync_state varchar(20) NOT NULL DEFAULT 'not_needed' CHECK (
    wordpress_sync_state IN ('not_needed', 'pending', 'synced', 'failed')
  ),
  wordpress_sync_attempts integer NOT NULL DEFAULT 0 CHECK (
    wordpress_sync_attempts >= 0
  ),
  wordpress_next_retry_at timestamptz,
  wordpress_last_error text,
  CONSTRAINT order_fulfillments_packed_snapshot_check CHECK (
    state <> 'packed' OR (completion_snapshot IS NOT NULL AND packed_at IS NOT NULL)
  ),
  CONSTRAINT order_fulfillments_cancel_reason_check CHECK (
    state <> 'cancelled'
    OR (
      cancelled_by IS NOT NULL
      AND length(trim(cancelled_by)) > 0
      AND cancel_reason IS NOT NULL
      AND length(trim(cancel_reason)) > 0
    )
  )
);

CREATE INDEX order_fulfillments_state_updated_idx
  ON order_fulfillments (state, updated_at DESC);

CREATE INDEX order_fulfillments_wordpress_sync_idx
  ON order_fulfillments (wordpress_sync_state, wordpress_next_retry_at)
  WHERE wordpress_sync_state IN ('pending', 'failed');

CREATE TABLE fulfillment_scan_events (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES order_fulfillments(id),
  client_event_id uuid NOT NULL UNIQUE,
  raw_barcode text NOT NULL CHECK (
    length(raw_barcode) BETWEEN 1 AND 512
  ),
  barcode_type varchar(20),
  product_id bigint CHECK (product_id IS NULL OR product_id > 0),
  variation_id bigint CHECK (variation_id IS NULL OR variation_id >= 0),
  order_item_id bigint CHECK (order_item_id IS NULL OR order_item_id > 0),
  coa_id varchar(120),
  lot varchar(120),
  result varchar(20) NOT NULL CHECK (result IN ('accepted', 'rejected')),
  reason_code varchar(40) NOT NULL CHECK (length(trim(reason_code)) > 0),
  quantity_delta integer NOT NULL DEFAULT 0 CHECK (quantity_delta >= 0),
  response_snapshot jsonb NOT NULL,
  actor_id varchar(100) NOT NULL CHECK (length(trim(actor_id)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_scan_events_result_quantity_check CHECK (
    (result = 'accepted' AND quantity_delta > 0)
    OR (result = 'rejected' AND quantity_delta = 0)
  )
);

CREATE INDEX fulfillment_scan_events_fulfillment_created_idx
  ON fulfillment_scan_events (fulfillment_id, created_at);

CREATE TABLE fulfillment_events (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES order_fulfillments(id),
  event_type varchar(30) NOT NULL CHECK (
    event_type IN (
      'started',
      'resumed',
      'cancelled',
      'packed',
      'sync_succeeded',
      'sync_failed'
    )
  ),
  actor_id varchar(100) NOT NULL CHECK (length(trim(actor_id)) > 0),
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fulfillment_events_fulfillment_created_idx
  ON fulfillment_events (fulfillment_id, created_at);
