CREATE TABLE fulfillment_evidence_sets (
  fulfillment_id uuid PRIMARY KEY REFERENCES order_fulfillments(id) ON DELETE CASCADE,
  order_id bigint NOT NULL CHECK (order_id > 0),
  order_number varchar(40) NOT NULL CHECK (length(trim(order_number)) > 0),
  state varchar(16) NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'confirmed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmation_client_event_id uuid UNIQUE,
  confirmed_by varchar(100),
  confirmed_at timestamptz,
  notification_state varchar(24) NOT NULL DEFAULT 'not_configured' CHECK (
    notification_state IN ('not_configured', 'queued', 'sent', 'failed')
  ),
  notification_message varchar(300) NOT NULL DEFAULT 'Email delivery is waiting for provider configuration.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_evidence_confirmation_check CHECK (
    (state = 'draft' AND confirmed_by IS NULL AND confirmed_at IS NULL) OR
    (state = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_client_event_id IS NOT NULL)
  )
);

CREATE TABLE fulfillment_evidence_files (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES fulfillment_evidence_sets(fulfillment_id) ON DELETE CASCADE,
  client_event_id uuid NOT NULL UNIQUE,
  kind varchar(24) NOT NULL CHECK (kind IN ('contents', 'sealed_label')),
  label varchar(120) NOT NULL CHECK (length(trim(label)) > 0),
  mime varchar(40) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 12582912),
  width integer NOT NULL CHECK (width > 0 AND width <= 12000),
  height integer NOT NULL CHECK (height > 0 AND height <= 12000),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key varchar(260) NOT NULL UNIQUE CHECK (length(trim(storage_key)) > 0),
  customer_visible boolean NOT NULL DEFAULT true,
  captured_by varchar(100) NOT NULL CHECK (length(trim(captured_by)) > 0),
  captured_at timestamptz NOT NULL DEFAULT now(),
  deleted_by varchar(100),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX fulfillment_evidence_files_active_kind_idx
  ON fulfillment_evidence_files (fulfillment_id, kind)
  WHERE deleted_at IS NULL;

CREATE INDEX fulfillment_evidence_files_fulfillment_idx
  ON fulfillment_evidence_files (fulfillment_id, captured_at DESC);

CREATE TABLE fulfillment_evidence_events (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES fulfillment_evidence_sets(fulfillment_id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES fulfillment_evidence_files(id),
  client_event_id uuid,
  event_type varchar(32) NOT NULL CHECK (
    event_type IN ('uploaded', 'replaced', 'removed', 'confirmed', 'notification_queued', 'notification_sent', 'notification_failed')
  ),
  actor_id varchar(100) NOT NULL CHECK (length(trim(actor_id)) > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX fulfillment_evidence_events_client_event_idx
  ON fulfillment_evidence_events (client_event_id, event_type)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX fulfillment_evidence_events_fulfillment_idx
  ON fulfillment_evidence_events (fulfillment_id, created_at DESC);

