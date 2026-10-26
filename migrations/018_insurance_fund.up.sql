CREATE TABLE insurance_fund_claims (
  id uuid PRIMARY KEY,
  order_id bigint NOT NULL CHECK (order_id > 0),
  order_number varchar(40) NOT NULL CHECK (length(trim(order_number)) > 0),
  customer_name varchar(200) NOT NULL DEFAULT '',
  customer_email varchar(320) NOT NULL DEFAULT '',
  currency char(3) NOT NULL DEFAULT 'USD',
  order_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (order_total >= 0),
  protection_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (protection_fee >= 0),
  claim_amount numeric(12,2) NOT NULL CHECK (claim_amount > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  recorded_by varchar(100) NOT NULL CHECK (length(trim(recorded_by)) > 0),
  recorded_by_name varchar(160) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by varchar(100),
  void_reason text,
  CONSTRAINT insurance_fund_claims_void_check CHECK (
    status = 'active'
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(voided_by)) > 0)
  )
);

CREATE UNIQUE INDEX insurance_fund_claims_active_order_idx
  ON insurance_fund_claims (order_id)
  WHERE status = 'active';

CREATE INDEX insurance_fund_claims_created_idx
  ON insurance_fund_claims (created_at DESC);
