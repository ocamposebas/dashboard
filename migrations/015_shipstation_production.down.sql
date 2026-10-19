ALTER TABLE fulfillment_shipping_events
  DROP CONSTRAINT fulfillment_shipping_events_event_type_check,
  ADD CONSTRAINT fulfillment_shipping_events_event_type_check CHECK (
    event_type IN (
      'purchase_started', 'purchase_replayed', 'purchase_failed', 'purchase_unknown',
      'reconciliation_started', 'reconciliation_waiting', 'label_ready', 'label_reprinted'
    )
  );

ALTER TABLE fulfillment_shipping_labels
  DROP COLUMN voided_at,
  DROP COLUMN wordpress_sync_message,
  DROP COLUMN wordpress_synced_at,
  DROP COLUMN wordpress_sync_state;
