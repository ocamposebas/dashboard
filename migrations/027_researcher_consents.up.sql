CREATE TABLE researcher_consents (
  id uuid PRIMARY KEY,
  visitor_token_hash char(64) NOT NULL UNIQUE,
  researcher_type varchar(48) NOT NULL CHECK (
    researcher_type IN (
      'academic_university',
      'independent_private_lab',
      'commercial_biotech',
      'institute_nonprofit',
      'qualified_research_organization'
    )
  ),
  confirms_legal_age boolean NOT NULL CHECK (confirms_legal_age),
  confirms_research_only boolean NOT NULL CHECK (confirms_research_only),
  consent_version varchar(48) NOT NULL,
  policy_version varchar(48) NOT NULL,
  source varchar(48) NOT NULL DEFAULT 'storefront_gate',
  customer_id bigint CHECK (customer_id IS NULL OR customer_id > 0),
  customer_email varchar(320),
  customer_display_name varchar(200),
  ip_hash char(64),
  user_agent_hash char(64),
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  linked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > accepted_at),
  CHECK (customer_email IS NULL OR customer_email = lower(customer_email))
);

CREATE INDEX researcher_consents_customer_id_idx
  ON researcher_consents (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX researcher_consents_customer_email_idx
  ON researcher_consents (customer_email)
  WHERE customer_email IS NOT NULL;

CREATE INDEX researcher_consents_accepted_at_idx
  ON researcher_consents (accepted_at DESC);

CREATE TABLE researcher_consent_events (
  id bigserial PRIMARY KEY,
  consent_id uuid NOT NULL REFERENCES researcher_consents(id) ON DELETE CASCADE,
  event_type varchar(24) NOT NULL CHECK (event_type IN ('accepted', 'renewed', 'linked')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX researcher_consent_events_consent_idx
  ON researcher_consent_events (consent_id, created_at DESC);
