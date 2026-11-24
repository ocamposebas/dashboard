CREATE TABLE customer_review_invitations (
  id uuid PRIMARY KEY,
  order_id bigint UNIQUE NOT NULL CHECK (order_id > 0),
  order_number varchar(80) NOT NULL,
  recipient_key char(64) NOT NULL,
  created_by varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  delivery_state text NOT NULL CHECK (delivery_state IN ('sending', 'sent', 'uncertain', 'failed')),
  sent_at timestamptz,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  body varchar(1200),
  submitted_at timestamptz,
  published_at timestamptz,
  CHECK ((rating IS NULL) = (submitted_at IS NULL)),
  CHECK (published_at IS NULL OR submitted_at IS NOT NULL)
);

CREATE INDEX customer_reviews_published_idx
  ON customer_review_invitations (published_at DESC) WHERE published_at IS NOT NULL;

CREATE TABLE customer_review_opt_outs (
  recipient_key char(64) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
