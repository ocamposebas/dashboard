CREATE TABLE barcode_labels (
  barcode_value varchar(20) PRIMARY KEY CHECK (
    barcode_value ~ '^[0-9]{20}$'
  ),
  entity_type varchar(12) NOT NULL CHECK (
    entity_type IN ('product', 'variation', 'batch')
  ),
  product_id bigint NOT NULL CHECK (product_id > 0),
  variation_id bigint NOT NULL DEFAULT 0 CHECK (variation_id >= 0),
  coa_id varchar(120) NOT NULL DEFAULT '',
  lot varchar(120) NOT NULL DEFAULT '',
  created_by varchar(100) NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barcode_labels_entity_unique UNIQUE (
    entity_type, product_id, variation_id, coa_id, lot
  ),
  CONSTRAINT barcode_labels_type_prefix_check CHECK (
    left(barcode_value, 2) = CASE entity_type
      WHEN 'product' THEN '11'
      WHEN 'variation' THEN '12'
      WHEN 'batch' THEN '13'
    END
  ),
  CONSTRAINT barcode_labels_entity_shape_check CHECK (
    (entity_type = 'product' AND variation_id = 0 AND coa_id = '' AND lot = '')
    OR (entity_type = 'variation' AND variation_id > 0 AND coa_id = '' AND lot = '')
    OR (entity_type = 'batch' AND coa_id <> '' AND lot <> '')
  )
);

CREATE INDEX barcode_labels_product_idx
  ON barcode_labels (product_id, variation_id, entity_type);
