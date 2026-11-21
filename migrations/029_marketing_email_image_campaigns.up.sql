CREATE TABLE marketing_email_assets (
  id uuid PRIMARY KEY,
  file_name varchar(255) NOT NULL,
  mime varchar(32) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 char(64) NOT NULL,
  content bytea NOT NULL,
  created_by varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX marketing_email_assets_sha256_unique
  ON marketing_email_assets (sha256);

ALTER TABLE marketing_email_campaigns
  ADD COLUMN content_mode varchar(24) NOT NULL DEFAULT 'template',
  ADD COLUMN image_asset_id uuid REFERENCES marketing_email_assets(id) ON DELETE RESTRICT,
  ADD COLUMN image_alt varchar(240) NOT NULL DEFAULT '',
  ADD COLUMN image_link text NOT NULL DEFAULT '';

ALTER TABLE marketing_email_campaigns
  ADD CONSTRAINT marketing_email_campaigns_content_mode_check
  CHECK (content_mode IN ('template', 'image'));

ALTER TABLE marketing_email_campaigns
  DROP CONSTRAINT IF EXISTS marketing_email_campaigns_heading_check;

ALTER TABLE marketing_email_campaigns
  DROP CONSTRAINT IF EXISTS marketing_email_campaigns_message_check;

ALTER TABLE marketing_email_campaigns
  ADD CONSTRAINT marketing_email_campaigns_content_check
  CHECK (
    (
      content_mode = 'template'
      AND length(trim(heading)) BETWEEN 2 AND 180
      AND length(trim(message)) BETWEEN 2 AND 5000
    )
    OR
    (
      content_mode = 'image'
      AND image_asset_id IS NOT NULL
      AND length(trim(image_alt)) BETWEEN 2 AND 240
      AND length(image_link) <= 1000
    )
  );

CREATE INDEX marketing_email_campaigns_image_asset_idx
  ON marketing_email_campaigns (image_asset_id)
  WHERE image_asset_id IS NOT NULL;
