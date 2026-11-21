ALTER TABLE marketing_email_campaigns
  DROP CONSTRAINT IF EXISTS marketing_email_campaigns_content_check;

ALTER TABLE marketing_email_campaigns
  DROP CONSTRAINT IF EXISTS marketing_email_campaigns_content_mode_check;

ALTER TABLE marketing_email_campaigns
  DROP COLUMN IF EXISTS image_link,
  DROP COLUMN IF EXISTS image_alt,
  DROP COLUMN IF EXISTS image_asset_id,
  DROP COLUMN IF EXISTS content_mode;

ALTER TABLE marketing_email_campaigns
  ADD CONSTRAINT marketing_email_campaigns_heading_check
  CHECK (length(trim(heading)) BETWEEN 2 AND 180);

ALTER TABLE marketing_email_campaigns
  ADD CONSTRAINT marketing_email_campaigns_message_check
  CHECK (length(trim(message)) BETWEEN 2 AND 5000);

DROP TABLE IF EXISTS marketing_email_assets;
