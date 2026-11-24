CREATE TABLE customer_review_automation (
  id smallint PRIMARY KEY CHECK (id = 1),
  enabled_since timestamptz
);

INSERT INTO customer_review_automation (id, enabled_since) VALUES (1, now());

CREATE TABLE customer_review_automation_skips (
  order_id bigint PRIMARY KEY CHECK (order_id > 0)
);

CREATE INDEX customer_reviews_delivered_idx ON delivery_monitor_shipments (delivered_at, order_id)
  WHERE status = 'delivered' AND delivered_at IS NOT NULL;
