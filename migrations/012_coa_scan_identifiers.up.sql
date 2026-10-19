CREATE TABLE coa_scan_identifiers (
  canonical_value text PRIMARY KEY CHECK (
    length(canonical_value) BETWEEN 1 AND 2048
  ),
  raw_value text NOT NULL CHECK (
    length(raw_value) BETWEEN 1 AND 2048
  ),
  coa_reference varchar(160) NOT NULL CHECK (
    length(trim(coa_reference)) > 0
  ),
  provider varchar(40) NOT NULL CHECK (
    length(trim(provider)) > 0
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_by varchar(100) NOT NULL CHECK (
    length(trim(created_by)) > 0
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coa_scan_identifiers_reference_idx
  ON coa_scan_identifiers (lower(coa_reference))
  WHERE is_active = true;

-- These are confirmed QR values already printed on Phase One Labz vials. The
-- COA reference is used instead of a WordPress numeric id so the mapping stays
-- stable if a certificate is re-imported.
INSERT INTO coa_scan_identifiers (
  canonical_value,
  raw_value,
  coa_reference,
  provider,
  created_by
) VALUES
  (
    'https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe',
    'https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe',
    'COA-2026-GI8-SM',
    'ils',
    'verified-vial-import'
  ),
  (
    'https://portal.ils-lab.com/verify/MkH533f-jOUYkKsp',
    'http://portal.ils-lab.com/verify/MkH533f-jOUYkKsp',
    'COA-2026-VM8MMY',
    'ils',
    'verified-vial-import'
  )
ON CONFLICT (canonical_value) DO NOTHING;
