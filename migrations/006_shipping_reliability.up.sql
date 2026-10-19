ALTER TABLE fulfillment_shipping_labels
  DROP CONSTRAINT fulfillment_shipping_labels_state_check,
  DROP CONSTRAINT fulfillment_shipping_mock_ready_check;

ALTER TABLE fulfillment_shipping_labels
  ADD CONSTRAINT fulfillment_shipping_labels_state_check CHECK (
    state IN ('purchase_pending', 'purchase_unknown', 'label_ready', 'failed', 'voided')
  );

ALTER TABLE fulfillment_shipping_labels
  ALTER COLUMN label_id DROP NOT NULL,
  ALTER COLUMN tracking_number DROP NOT NULL,
  ADD COLUMN external_shipment_key varchar(180),
  ADD COLUMN shipment_id varchar(160),
  ADD COLUMN label_download_url text,
  ADD COLUMN failure_code varchar(80),
  ADD COLUMN failure_message varchar(500),
  ADD COLUMN source_shipping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN print_count integer NOT NULL DEFAULT 0 CHECK (print_count >= 0),
  ADD COLUMN last_printed_at timestamptz,
  ADD COLUMN purchase_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN purchase_completed_at timestamptz,
  ADD COLUMN last_reconciled_at timestamptz;

UPDATE fulfillment_shipping_labels
SET external_shipment_key = 'phaseone-fulfillment-' || fulfillment_id::text,
    shipment_id = 'mock-shipment-' || id::text,
    purchase_started_at = created_at,
    purchase_completed_at = created_at
WHERE external_shipment_key IS NULL;

ALTER TABLE fulfillment_shipping_labels
  ALTER COLUMN external_shipment_key SET NOT NULL,
  ADD CONSTRAINT fulfillment_shipping_labels_external_key_unique UNIQUE (external_shipment_key),
  ADD CONSTRAINT fulfillment_shipping_labels_ready_fields_check CHECK (
    state <> 'label_ready' OR (
      label_id IS NOT NULL AND length(trim(label_id)) > 0 AND
      tracking_number IS NOT NULL AND length(trim(tracking_number)) > 0 AND
      purchase_completed_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT fulfillment_shipping_labels_error_fields_check CHECK (
    state <> 'failed' OR (
      failure_code IS NOT NULL AND length(trim(failure_code)) > 0 AND
      failure_message IS NOT NULL AND length(trim(failure_message)) > 0
    )
  );

CREATE INDEX fulfillment_shipping_labels_state_idx
  ON fulfillment_shipping_labels (state, updated_at DESC);

CREATE INDEX fulfillment_shipping_labels_rate_idx
  ON fulfillment_shipping_labels (rate_id, provider_mode, created_at DESC);

CREATE TABLE fulfillment_shipping_events (
  id uuid PRIMARY KEY,
  shipping_label_id uuid NOT NULL REFERENCES fulfillment_shipping_labels(id) ON DELETE CASCADE,
  client_event_id uuid,
  event_type varchar(40) NOT NULL CHECK (
    event_type IN (
      'purchase_started',
      'purchase_replayed',
      'purchase_failed',
      'purchase_unknown',
      'reconciliation_started',
      'reconciliation_waiting',
      'label_ready',
      'label_reprinted'
    )
  ),
  actor_id varchar(100) NOT NULL CHECK (length(trim(actor_id)) > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX fulfillment_shipping_events_client_event_unique
  ON fulfillment_shipping_events (client_event_id, event_type)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX fulfillment_shipping_events_label_idx
  ON fulfillment_shipping_events (shipping_label_id, created_at DESC);
