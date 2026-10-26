ALTER TABLE marketing_email_campaigns
  DROP CONSTRAINT IF EXISTS marketing_email_campaigns_products_array;

ALTER TABLE marketing_email_campaigns
  DROP COLUMN IF EXISTS products;
