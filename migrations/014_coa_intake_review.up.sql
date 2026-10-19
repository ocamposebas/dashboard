ALTER TABLE coa_certificates
  ADD COLUMN intake_analysis jsonb NOT NULL DEFAULT '{}'::jsonb;
