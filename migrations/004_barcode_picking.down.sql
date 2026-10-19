DROP INDEX IF EXISTS barcode_labels_active_idx;

ALTER TABLE barcode_labels
  DROP COLUMN is_active;
