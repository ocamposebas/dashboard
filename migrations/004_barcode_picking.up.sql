ALTER TABLE barcode_labels
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

CREATE INDEX barcode_labels_active_idx
  ON barcode_labels (barcode_value)
  WHERE is_active = true;
