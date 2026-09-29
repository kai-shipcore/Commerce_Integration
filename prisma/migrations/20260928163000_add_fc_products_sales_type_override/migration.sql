-- Allow SKU Master users to override the order-derived Original/Custom
-- classification without overloading the independent lifecycle sales_status.
ALTER TABLE shipcore.fc_products
  ADD COLUMN IF NOT EXISTS sales_type_override VARCHAR(10) NULL;

ALTER TABLE shipcore.fc_products
  DROP CONSTRAINT IF EXISTS fc_products_sales_type_override_check;

ALTER TABLE shipcore.fc_products
  ADD CONSTRAINT fc_products_sales_type_override_check
  CHECK (sales_type_override IS NULL OR sales_type_override IN ('Original', 'Custom'));
