ALTER TABLE order_fulfillments
  DROP CONSTRAINT order_fulfillments_state_check;

ALTER TABLE order_fulfillments
  ADD CONSTRAINT order_fulfillments_state_check CHECK (
    state IN ('open', 'paused', 'packed', 'cancelled')
  );

ALTER TABLE fulfillment_events
  DROP CONSTRAINT fulfillment_events_event_type_check;

ALTER TABLE fulfillment_events
  ADD CONSTRAINT fulfillment_events_event_type_check CHECK (
    event_type IN (
      'started',
      'resumed',
      'paused',
      'cancelled',
      'packed',
      'sync_succeeded',
      'sync_failed'
    )
  );

DO $$
BEGIN
  IF (SELECT count(*) FROM order_fulfillments WHERE state = 'open') > 1 THEN
    RAISE EXCEPTION 'Cannot enable the single-active-order guard while multiple fulfillments are open';
  END IF;
END $$;

CREATE UNIQUE INDEX order_fulfillments_single_active_idx
  ON order_fulfillments ((state))
  WHERE state = 'open';
