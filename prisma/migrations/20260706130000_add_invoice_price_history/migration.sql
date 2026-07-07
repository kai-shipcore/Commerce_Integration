CREATE TABLE IF NOT EXISTS shipcore.fc_price_list_files (
  id BIGSERIAL PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  file_data BYTEA NOT NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipcore.fc_sku_price_history (
  id BIGSERIAL PRIMARY KEY,
  factory_id BIGINT NOT NULL REFERENCES shipcore.fc_factories(id),
  sku TEXT NOT NULL,
  effective_date DATE NOT NULL,
  unit_price NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  reason TEXT,
  source_file_id BIGINT REFERENCES shipcore.fc_price_list_files(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_sku_price_history_unique UNIQUE (factory_id, sku, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_fc_sku_price_history_lookup
  ON shipcore.fc_sku_price_history (factory_id, sku, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_fc_sku_price_history_sku
  ON shipcore.fc_sku_price_history (sku);

