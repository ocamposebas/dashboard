ALTER TABLE site_control_state
  ADD COLUMN IF NOT EXISTS navigation jsonb NOT NULL DEFAULT '{"items":[{"id":"encapsulated-raws","label":"Encapsulated RAW''s","href":"/research-peptides/encapsulated-raws/","placement":"shop","enabled":true},{"id":"research-atomizers","label":"Research Atomizer''s","href":"/research-peptides/research-atomizers/","placement":"shop","enabled":true}]}'::jsonb;

