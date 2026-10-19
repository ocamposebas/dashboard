DROP TABLE fulfillment_shipping_events;

DROP INDEX fulfillment_shipping_labels_rate_idx;
DROP INDEX fulfillment_shipping_labels_state_idx;

DELETE FROM fulfillment_shipping_labels WHERE state <> 'label_ready';

ALTER TABLE fulfillment_shipping_labels
  DROP CONSTRAINT fulfillment_shipping_labels_error_fields_check,
  DROP CONSTRAINT fulfillment_shipping_labels_ready_fields_check,
  DROP CONSTRAINT fulfillment_shipping_labels_external_key_unique,
  DROP COLUMN last_reconciled_at,
  DROP COLUMN purchase_completed_at,
  DROP COLUMN purchase_started_at,
  DROP COLUMN last_printed_at,
  DROP COLUMN print_count,
  DROP COLUMN source_shipping_snapshot,
  DROP COLUMN failure_message,
  DROP COLUMN failure_code,
  DROP COLUMN label_download_url,
  DROP COLUMN shipment_id,
  DROP COLUMN external_shipment_key;

ALTER TABLE fulfillment_shipping_labels
  ALTER COLUMN label_id SET NOT NULL,
  ALTER COLUMN tracking_number SET NOT NULL,
  DROP CONSTRAINT fulfillment_shipping_labels_state_check,
  ADD CONSTRAINT fulfillment_shipping_labels_state_check CHECK (
    state IN ('draft', 'purchase_pending', 'purchase_unknown', 'label_ready', 'voided')
  ),
  ADD CONSTRAINT fulfillment_shipping_mock_ready_check CHECK (
    provider_mode <> 'mock' OR state = 'label_ready'
  );
