-- Category-scoped indexes for planning dashboard API.
-- The dashboard now loads one product category at a time, so these indexes
-- keep category filtering and item joins narrow before response assembly.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_products_category_master_sku
  ON shipcore.fc_products (category_code, master_sku);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_items_master_sku_container
  ON shipcore.fc_container_items (master_sku, container_id);
