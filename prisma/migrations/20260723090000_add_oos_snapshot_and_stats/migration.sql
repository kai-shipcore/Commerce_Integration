CREATE TABLE IF NOT EXISTS shipcore.fc_inventory_history_snapshot (
    id             SERIAL PRIMARY KEY,
    master_sku     VARCHAR(128) NOT NULL,
    snapshot_date  DATE         NOT NULL,
    available      INTEGER      NOT NULL DEFAULT 0,
    backorder      INTEGER      NOT NULL DEFAULT 0,
    synced_at      TIMESTAMPTZ  NOT NULL,
    UNIQUE (master_sku, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_fc_inv_hist_snapshot_sku
    ON shipcore.fc_inventory_history_snapshot (master_sku);

ALTER TABLE shipcore.fc_stats
  ADD COLUMN IF NOT EXISTS oos_days_90d        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oos_lost_demand_90d NUMERIC(12, 2);

ALTER TABLE shipcore.fc_stats_custom
  ADD COLUMN IF NOT EXISTS oos_days_90d        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oos_lost_demand_90d NUMERIC(12, 2);
