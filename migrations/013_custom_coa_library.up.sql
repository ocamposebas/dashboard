CREATE TABLE coa_certificates (
  id varchar(120) PRIMARY KEY,
  legacy_wp_post_id bigint UNIQUE,
  coa_number varchar(180) NOT NULL,
  product_name varchar(240) NOT NULL DEFAULT '',
  compound varchar(240) NOT NULL DEFAULT '',
  family_name varchar(240) NOT NULL DEFAULT '',
  family_key varchar(240) NOT NULL DEFAULT '',
  strength varchar(120) NOT NULL DEFAULT '',
  batch varchar(180) NOT NULL DEFAULT '',
  lot varchar(180) NOT NULL DEFAULT '',
  certificate_date date,
  status varchar(40) NOT NULL DEFAULT 'Review'
    CHECK (status IN ('Review', 'Available', 'Archived')),
  purity varchar(120) NOT NULL DEFAULT '',
  laboratory varchar(240) NOT NULL DEFAULT '',
  method varchar(240) NOT NULL DEFAULT '',
  tested text NOT NULL DEFAULT '',
  current_shipping_lot boolean NOT NULL DEFAULT false,
  external_file_url text NOT NULL DEFAULT '',
  verify_url text NOT NULL DEFAULT '',
  file_attachment_id bigint NOT NULL DEFAULT 0,
  matched_product_id bigint NOT NULL DEFAULT 0,
  matched_variation_id bigint NOT NULL DEFAULT 0,
  skus jsonb NOT NULL DEFAULT '[]'::jsonb,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  panel_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_coa jsonb NOT NULL DEFAULT '{}'::jsonb,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  source varchar(40) NOT NULL DEFAULT 'custom'
    CHECK (source IN ('custom', 'wordpress_import')),
  source_fingerprint char(64),
  document_id varchar(80),
  revision bigint NOT NULL DEFAULT 1,
  created_by varchar(100) NOT NULL,
  updated_by varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT coa_certificates_identity CHECK (
    length(trim(coa_number)) > 0 AND
    (length(trim(product_name)) > 0 OR length(trim(family_name)) > 0)
  )
);

CREATE UNIQUE INDEX coa_certificates_number_key
  ON coa_certificates (lower(coa_number));

CREATE INDEX coa_certificates_source_fingerprint_idx
  ON coa_certificates (source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

CREATE INDEX coa_certificates_public_idx
  ON coa_certificates (status, current_shipping_lot, certificate_date DESC, updated_at DESC);

CREATE INDEX coa_certificates_product_idx
  ON coa_certificates (matched_product_id, matched_variation_id);

CREATE TABLE coa_documents (
  id varchar(80) PRIMARY KEY,
  certificate_id varchar(120) NOT NULL REFERENCES coa_certificates(id) ON DELETE CASCADE,
  file_name varchar(240) NOT NULL,
  mime_type varchar(80) NOT NULL CHECK (mime_type = 'application/pdf'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 12582912),
  sha256 char(64) NOT NULL UNIQUE,
  content bytea NOT NULL,
  created_by varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coa_certificates
  ADD CONSTRAINT coa_certificates_document_fk
  FOREIGN KEY (document_id) REFERENCES coa_documents(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE coa_certificate_events (
  id varchar(80) PRIMARY KEY,
  certificate_id varchar(120) NOT NULL REFERENCES coa_certificates(id) ON DELETE CASCADE,
  event_type varchar(60) NOT NULL,
  actor_id varchar(100) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coa_certificate_events_timeline_idx
  ON coa_certificate_events (certificate_id, occurred_at DESC);

