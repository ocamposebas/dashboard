DROP TABLE IF EXISTS coa_certificate_events;
ALTER TABLE IF EXISTS coa_certificates DROP CONSTRAINT IF EXISTS coa_certificates_document_fk;
DROP TABLE IF EXISTS coa_documents;
DROP TABLE IF EXISTS coa_certificates;
