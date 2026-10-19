CREATE TABLE fulfillment_shipping_labels (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL UNIQUE REFERENCES order_fulfillments(id),
  client_event_id uuid NOT NULL UNIQUE,
  order_id bigint NOT NULL CHECK (order_id > 0),
  order_number varchar(40) NOT NULL CHECK (length(trim(order_number)) > 0),
  state varchar(24) NOT NULL CHECK (
    state IN ('draft', 'purchase_pending', 'purchase_unknown', 'label_ready', 'voided')
  ),
  provider varchar(30) NOT NULL DEFAULT 'shipstation' CHECK (provider = 'shipstation'),
  provider_mode varchar(12) NOT NULL CHECK (provider_mode IN ('mock', 'live')),
  carrier_id varchar(100) NOT NULL CHECK (length(trim(carrier_id)) > 0),
  carrier_code varchar(100) NOT NULL CHECK (length(trim(carrier_code)) > 0),
  carrier_name varchar(160) NOT NULL CHECK (length(trim(carrier_name)) > 0),
  service_code varchar(120) NOT NULL CHECK (length(trim(service_code)) > 0),
  service_name varchar(160) NOT NULL CHECK (length(trim(service_name)) > 0),
  rate_id varchar(160) NOT NULL CHECK (length(trim(rate_id)) > 0),
  rate_amount numeric(12, 2) NOT NULL CHECK (rate_amount >= 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  package_snapshot jsonb NOT NULL,
  destination_snapshot jsonb NOT NULL,
  label_id varchar(160) NOT NULL UNIQUE CHECK (length(trim(label_id)) > 0),
  tracking_number varchar(160) NOT NULL UNIQUE CHECK (length(trim(tracking_number)) > 0),
  label_format varchar(12) NOT NULL DEFAULT '4x6' CHECK (label_format = '4x6'),
  created_by varchar(100) NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_shipping_mock_ready_check CHECK (
    provider_mode <> 'mock' OR state = 'label_ready'
  )
);

CREATE INDEX fulfillment_shipping_labels_order_idx
  ON fulfillment_shipping_labels (order_id, created_at DESC);
