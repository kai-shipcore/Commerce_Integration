-- Part SKU Generator: generated Part SKUs and their per-SKU checklist items.

CREATE TABLE IF NOT EXISTS shipcore.fc_part_skus (
  id          BIGSERIAL PRIMARY KEY,
  sku         TEXT NOT NULL,
  part_name   TEXT NOT NULL,
  make        TEXT NOT NULL,
  make_abbr   TEXT NOT NULL,
  model       TEXT NOT NULL,
  model_abbr  TEXT NOT NULL,
  code        TEXT NOT NULL,
  initial     TEXT NOT NULL,
  side        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_part_skus_sku_key UNIQUE (sku)
);

CREATE INDEX IF NOT EXISTS idx_fc_part_skus_is_active ON shipcore.fc_part_skus (is_active);

CREATE TABLE IF NOT EXISTS shipcore.fc_part_sku_checklist_items (
  id           BIGSERIAL PRIMARY KEY,
  part_sku_id  BIGINT NOT NULL REFERENCES shipcore.fc_part_skus(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_part_sku_checklist_items_part_sku_id ON shipcore.fc_part_sku_checklist_items (part_sku_id);
