CREATE TABLE delivery_monitor_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  delay_days smallint NOT NULL DEFAULT 5 CHECK (delay_days BETWEEN 1 AND 30),
  recipient_user_id varchar(100),
  email_enabled boolean NOT NULL DEFAULT true,
  initialized_at timestamptz,
  last_run_at timestamptz,
  last_run_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO delivery_monitor_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE delivery_monitor_shipments (
  label_id varchar(160) PRIMARY KEY,
  fulfillment_id uuid NOT NULL,
  order_id bigint NOT NULL CHECK (order_id > 0),
  order_number varchar(50) NOT NULL,
  customer_name varchar(200) NOT NULL DEFAULT '',
  tracking_number varchar(160) NOT NULL,
  carrier_code varchar(100) NOT NULL DEFAULT '',
  service_code varchar(120) NOT NULL DEFAULT '',
  shipped_at timestamptz NOT NULL,
  estimated_delivery_at timestamptz,
  delivered_at timestamptz,
  last_event_at timestamptz,
  last_event_description text,
  status varchar(30) NOT NULL CHECK (status IN (
    'label_created', 'in_transit', 'delivery_attempt', 'exception', 'delivered', 'unknown'
  )),
  status_description varchar(240) NOT NULL DEFAULT '',
  exception_description text,
  days_in_transit integer NOT NULL DEFAULT 0 CHECK (days_in_transit >= 0),
  is_delayed boolean NOT NULL DEFAULT false,
  alert_kind varchar(20) CHECK (alert_kind IN ('delayed', 'exception')),
  alert_event_id uuid,
  alert_sent_at timestamptz,
  alert_error text,
  acknowledged_at timestamptz,
  acknowledged_by varchar(100),
  last_checked_at timestamptz,
  last_check_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_monitor_attention_idx
  ON delivery_monitor_shipments (is_delayed DESC, status, shipped_at);

CREATE INDEX delivery_monitor_order_idx
  ON delivery_monitor_shipments (order_id, updated_at DESC);
