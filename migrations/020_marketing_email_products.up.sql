ALTER TABLE marketing_email_campaigns
  ADD COLUMN products jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE marketing_email_campaigns
  ADD CONSTRAINT marketing_email_campaigns_products_array
  CHECK (jsonb_typeof(products) = 'array' AND jsonb_array_length(products) <= 4);
