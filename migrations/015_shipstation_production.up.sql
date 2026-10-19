ALTER TABLE fulfillment_shipping_labels
  ADD COLUMN wordpress_sync_state varchar(20) NOT NULL DEFAULT 'not_required' CHECK (
    wordpress_sync_state IN ('not_required', 'pending', 'synced', 'failed')
  ),
  ADD COLUMN wordpress_synced_at timestamptz,
  ADD COLUMN wordpress_sync_message varchar(500),
  ADD COLUMN voided_at timestamptz;

UPDATE fulfillment_shipping_labels
SET external_shipment_key = 'p1-' || fulfillment_id::text
WHERE external_shipment_key LIKE 'phaseone-fulfillment-%';

ALTER TABLE fulfillment_shipping_events
  DROP CONSTRAINT fulfillment_shipping_events_event_type_check,
  ADD CONSTRAINT fulfillment_shipping_events_event_type_check CHECK (
    event_type IN (
      'purchase_started',
      'purchase_replayed',
      'purchase_failed',
      'purchase_unknown',
      'reconciliation_started',
      'reconciliation_waiting',
      'label_ready',
      'label_reprinted',
      'wordpress_sync_succeeded',
      'wordpress_sync_failed',
      'label_voided'
    )
  );
