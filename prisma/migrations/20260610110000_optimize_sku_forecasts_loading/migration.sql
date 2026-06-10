-- Targeted performance indexes for /planning/sku-forecasts.
-- The SKU forecast page loads one category at a time and frequently looks up
-- active inbound containers for a selected master SKU.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_containers_incomplete_eta_id
  ON shipcore.fc_containers (eta_date NULLS LAST, id)
  INCLUDE (container_number, cbm_capacity, status)
  WHERE status <> 'complete';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_containers_active_eta_id
  ON shipcore.fc_containers (eta_date NULLS LAST, id)
  INCLUDE (container_number, cbm_capacity, status)
  WHERE status IN ('shipped', 'packing_received');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_containers_active_draft_eta_id
  ON shipcore.fc_containers (eta_date NULLS LAST, id)
  INCLUDE (container_number, cbm_capacity, status)
  WHERE status IN ('shipped', 'packing_received', 'draft');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_items_sku_positive_container
  ON shipcore.fc_container_items (master_sku, container_id)
  INCLUDE (qty, cbm_unit, total_cbm)
  WHERE qty > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_items_container_positive_sku
  ON shipcore.fc_container_items (container_id, master_sku)
  INCLUDE (qty, cbm_unit, total_cbm)
  WHERE qty > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_available_stock_sku_source
  ON shipcore.fc_available_stock (master_sku, source_type)
  INCLUDE (id, total_qty);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_item_allocations_source
  ON shipcore.fc_container_item_allocations (source_stock_id)
  INCLUDE (qty);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fc_container_item_allocations_container_source
  ON shipcore.fc_container_item_allocations (container_id, source_stock_id)
  INCLUDE (qty);
