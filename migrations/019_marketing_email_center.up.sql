CREATE TABLE marketing_contacts (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  first_name varchar(120) NOT NULL DEFAULT '',
  last_name varchar(120) NOT NULL DEFAULT '',
  source varchar(32) NOT NULL CHECK (source IN ('woocommerce', 'omnisend', 'manual')),
  status varchar(24) NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('subscribed', 'unconfirmed', 'unsubscribed', 'bounced')),
  tags text[] NOT NULL DEFAULT '{}',
  wp_customer_id bigint,
  consent_recorded_at timestamptz,
  unsubscribed_at timestamptz,
  last_emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX marketing_contacts_email_unique ON marketing_contacts (lower(email));
CREATE INDEX marketing_contacts_status_idx ON marketing_contacts (status, updated_at DESC);

CREATE TABLE marketing_email_campaigns (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  template_key varchar(40) NOT NULL,
  subject varchar(180) NOT NULL CHECK (length(trim(subject)) BETWEEN 2 AND 180),
  preheader varchar(240) NOT NULL DEFAULT '',
  heading varchar(180) NOT NULL CHECK (length(trim(heading)) BETWEEN 2 AND 180),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 2 AND 5000),
  button_label varchar(80) NOT NULL DEFAULT '',
  button_url text NOT NULL DEFAULT '',
  audience_tag varchar(80) NOT NULL DEFAULT '',
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'cancelled')),
  recipient_count integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  uncertain_count integer NOT NULL DEFAULT 0 CHECK (uncertain_count >= 0),
  created_by varchar(100) NOT NULL,
  created_by_name varchar(160) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  launched_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX marketing_email_campaigns_created_idx ON marketing_email_campaigns (created_at DESC);
CREATE INDEX marketing_email_campaigns_status_idx ON marketing_email_campaigns (status, updated_at);

CREATE TABLE marketing_email_deliveries (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES marketing_email_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES marketing_contacts(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL UNIQUE,
  status varchar(24) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'uncertain', 'skipped')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text NOT NULL DEFAULT '',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX marketing_email_deliveries_queue_idx ON marketing_email_deliveries (status, updated_at);
CREATE INDEX marketing_email_deliveries_campaign_idx ON marketing_email_deliveries (campaign_id, status);
