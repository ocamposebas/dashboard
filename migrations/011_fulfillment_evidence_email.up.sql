ALTER TABLE fulfillment_evidence_sets
  DROP CONSTRAINT IF EXISTS fulfillment_evidence_sets_notification_state_check;

ALTER TABLE fulfillment_evidence_sets
  ADD CONSTRAINT fulfillment_evidence_sets_notification_state_check CHECK (
    notification_state IN ('not_configured', 'queued', 'sent', 'uncertain', 'failed')
  );

ALTER TABLE fulfillment_evidence_sets
  ALTER COLUMN notification_message SET DEFAULT 'Customer email is disabled in this environment.';

UPDATE fulfillment_evidence_sets
SET notification_message = 'Customer email is disabled in this environment.'
WHERE notification_state = 'not_configured';

ALTER TABLE fulfillment_evidence_events
  DROP CONSTRAINT IF EXISTS fulfillment_evidence_events_event_type_check;

ALTER TABLE fulfillment_evidence_events
  ADD CONSTRAINT fulfillment_evidence_events_event_type_check CHECK (
    event_type IN (
      'uploaded', 'replaced', 'removed', 'confirmed',
      'notification_queued', 'notification_sent', 'notification_uncertain', 'notification_failed'
    )
  );
