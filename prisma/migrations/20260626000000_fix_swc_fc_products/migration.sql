-- Update existing fc_products rows that match SWC pattern
UPDATE shipcore.fc_products
SET sales_status = 'SWC',
    category_code = 'CC',
    category = 'Car Cover',
    updated_at = NOW()
WHERE master_sku ILIKE '%SWC%';

-- Insert SWC SKUs from velocity snapshot that aren't in fc_products yet
INSERT INTO shipcore.fc_products
  (master_sku, product_name, category, category_code, status, sales_status,
   moq, order_multiple, cbm_per_unit, case_qty, weight_kg, created_at, updated_at)
SELECT DISTINCT
  link_master_sku,
  link_master_sku,
  'Car Cover',
  'CC',
  'active'::shipcore.fc_product_status,
  'SWC',
  1, 1, 0.078, 1, 2.8,
  NOW(), NOW()
FROM shipcore.fc_velocity_link_snapshot
WHERE link_master_sku ILIKE '%SWC%'
  AND link_master_sku IS NOT NULL
ON CONFLICT (master_sku) DO NOTHING;
