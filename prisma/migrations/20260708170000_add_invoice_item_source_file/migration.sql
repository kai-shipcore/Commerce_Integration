-- Track which uploaded invoice Excel file created each invoice line item.

ALTER TABLE shipcore.fc_invoice_items
  ADD COLUMN IF NOT EXISTS source_file_id BIGINT REFERENCES shipcore.fc_price_list_files(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fc_invoice_items_source_file_id
  ON shipcore.fc_invoice_items (invoice_id, source_file_id);
