-- Floor Mat role is independent of lifecycle/sales status. A SKU may be, for
-- example, both a 1st Row component and Hold, so keep the two attributes in
-- separate columns.
ALTER TABLE shipcore.fc_products
  ADD COLUMN IF NOT EXISTS floor_mat_type VARCHAR(20);

ALTER TABLE shipcore.fc_products
  DROP CONSTRAINT IF EXISTS fc_products_floor_mat_type_check;

ALTER TABLE shipcore.fc_products
  ADD CONSTRAINT fc_products_floor_mat_type_check
  CHECK (
    floor_mat_type IS NULL OR floor_mat_type IN (
      '1+2 Set',
      '1+2+3 Set',
      '1st Row',
      '2nd Row',
      '3rd Row'
    )
  );

-- Preserve every existing Floor Mat classification while freeing
-- sales_status for Hold / Discontinued / TBD.
UPDATE shipcore.fc_products
SET floor_mat_type = sales_status,
    sales_status = NULL,
    updated_at = NOW()
WHERE sales_status IN ('1+2 Set', '1+2+3 Set', '1st Row', '2nd Row', '3rd Row');

CREATE INDEX IF NOT EXISTS idx_fc_products_floor_mat_type
  ON shipcore.fc_products (floor_mat_type)
  WHERE floor_mat_type IS NOT NULL;
