CREATE TABLE pep_review_connection (
  id smallint PRIMARY KEY CHECK (id = 1),
  encrypted_key text NOT NULL,
  enabled_at timestamptz NOT NULL,
  cursor_at timestamptz NOT NULL,
  last_success timestamptz,
  last_error text
);

CREATE TABLE pep_review_sent_orders (
  order_id bigint PRIMARY KEY,
  last_status text NOT NULL CHECK (last_status IN ('completed', 'refunded', 'cancelled'))
);
