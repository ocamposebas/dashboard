DROP INDEX IF EXISTS coa_certificates_current_testing_cost_idx;

ALTER TABLE coa_certificates
  DROP COLUMN IF EXISTS batch_unit_count,
  DROP COLUMN IF EXISTS testing_cost_total;
