-- Track already-produced stock that can be assigned to a container without a new PO.

CREATE TABLE IF NOT EXISTS shipcore.fc_available_stock (
  id BIGSERIAL PRIMARY KEY,
  source_type VARCHAR(20) NOT NULL
    CHECK (source_type IN ('remaining', 'mistake')),
  reference_no VARCHAR(100) NOT NULL,
  master_sku VARCHAR(128) NOT NULL
    REFERENCES shipcore.fc_products(master_sku)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  total_qty INTEGER NOT NULL CHECK (total_qty > 0),
  cbm_unit NUMERIC(14, 6) NOT NULL CHECK (cbm_unit > 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fc_available_stock_source
  ON shipcore.fc_available_stock (source_type, master_sku);

CREATE TABLE IF NOT EXISTS shipcore.fc_container_item_allocations (
  id BIGSERIAL PRIMARY KEY,
  container_id BIGINT NOT NULL
    REFERENCES shipcore.fc_containers(id)
    ON DELETE CASCADE,
  source_stock_id BIGINT NOT NULL
    REFERENCES shipcore.fc_available_stock(id)
    ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (container_id, source_stock_id)
);

CREATE INDEX IF NOT EXISTS idx_fc_container_allocations_source
  ON shipcore.fc_container_item_allocations (source_stock_id);

DROP TRIGGER IF EXISTS trg_fc_available_stock_updated_at ON shipcore.fc_available_stock;
CREATE TRIGGER trg_fc_available_stock_updated_at
BEFORE UPDATE ON shipcore.fc_available_stock
FOR EACH ROW EXECUTE FUNCTION shipcore.set_updated_at();

DROP TRIGGER IF EXISTS trg_fc_container_item_allocations_updated_at ON shipcore.fc_container_item_allocations;
CREATE TRIGGER trg_fc_container_item_allocations_updated_at
BEFORE UPDATE ON shipcore.fc_container_item_allocations
FOR EACH ROW EXECUTE FUNCTION shipcore.set_updated_at();
