-- Performance indexes for planning dashboard API
-- Fixes full table scans on fc_containers, fc_container_items, fc_products
-- which caused slow load times as data volume grew.

-- fc_containers: WHERE status != 'complete' + ORDER BY status, eta_date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_containers_status
  ON shipcore.fc_containers (status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_containers_status_eta
  ON shipcore.fc_containers (status, eta_date NULLS LAST);

-- fc_container_items: JOIN on container_id (used in every container subquery)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_items_container_id
  ON shipcore.fc_container_items (container_id);

-- fc_container_items: GROUP BY / JOIN on master_sku
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_items_master_sku
  ON shipcore.fc_container_items (master_sku);

-- fc_container_items: composite for subquery filter + grouping
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_items_container_sku
  ON shipcore.fc_container_items (container_id, master_sku);

-- fc_products: master_sku JOIN (used in 4+ queries per request)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_products_master_sku
  ON shipcore.fc_products (master_sku);
