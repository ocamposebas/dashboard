DROP INDEX IF EXISTS order_fulfillments_single_active_idx;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_fulfillments WHERE state = 'paused')
    OR EXISTS (SELECT 1 FROM fulfillment_events WHERE event_type = 'paused') THEN
    RAISE EXCEPTION 'Cannot roll back fulfillment queue while paused session history exists';
  END IF;
END $$;

ALTER TABLE fulfillment_events
  DROP CONSTRAINT fulfillment_events_event_type_check;

ALTER TABLE fulfillment_events
  ADD CONSTRAINT fulfillment_events_event_type_check CHECK (
    event_type IN (
      'started',
      'resumed',
      'cancelled',
      'packed',
      'sync_succeeded',
      'sync_failed'
    )
  );

ALTER TABLE order_fulfillments
  DROP CONSTRAINT order_fulfillments_state_check;

ALTER TABLE order_fulfillments
  ADD CONSTRAINT order_fulfillments_state_check CHECK (
    state IN ('open', 'packed', 'cancelled')
  );
