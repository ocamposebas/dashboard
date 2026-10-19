UPDATE fulfillment_evidence_sets
SET notification_state = 'failed',
    notification_message = 'Email delivery requires manual review.'
WHERE notification_state = 'uncertain';

ALTER TABLE fulfillment_evidence_sets
  ALTER COLUMN notification_message SET DEFAULT 'Email delivery is waiting for provider configuration.';

DELETE FROM fulfillment_evidence_events
WHERE event_type = 'notification_uncertain';

ALTER TABLE fulfillment_evidence_sets
  DROP CONSTRAINT IF EXISTS fulfillment_evidence_sets_notification_state_check;

ALTER TABLE fulfillment_evidence_sets
  ADD CONSTRAINT fulfillment_evidence_sets_notification_state_check CHECK (
    notification_state IN ('not_configured', 'queued', 'sent', 'failed')
  );

ALTER TABLE fulfillment_evidence_events
  DROP CONSTRAINT IF EXISTS fulfillment_evidence_events_event_type_check;

ALTER TABLE fulfillment_evidence_events
  ADD CONSTRAINT fulfillment_evidence_events_event_type_check CHECK (
    event_type IN (
      'uploaded', 'replaced', 'removed', 'confirmed',
      'notification_queued', 'notification_sent', 'notification_failed'
    )
  );
