ALTER TABLE coa_certificates
  ADD COLUMN testing_cost_total numeric(12,2) NOT NULL DEFAULT 0
    CHECK (testing_cost_total >= 0),
  ADD COLUMN batch_unit_count integer NOT NULL DEFAULT 0
    CHECK (batch_unit_count >= 0);

CREATE INDEX coa_certificates_current_testing_cost_idx
  ON coa_certificates (matched_product_id, matched_variation_id)
  WHERE status = 'Available'
    AND current_shipping_lot = true
    AND testing_cost_total > 0
    AND batch_unit_count > 0;
