CREATE TABLE IF NOT EXISTS shipcore.fc_velocity_link_snapshot_forecast (
  id              SERIAL PRIMARY KEY,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  order_date      DATE        NOT NULL,
  order_date_la   DATE        NOT NULL,
  item_category   TEXT        NOT NULL,
  channel         TEXT        NOT NULL,
  order_type      TEXT        NOT NULL,
  link_master_sku TEXT        NOT NULL,
  link_qty        INTEGER     NOT NULL DEFAULT 0,
  is_custom       CHAR(1)     NOT NULL DEFAULT 'N' CHECK (is_custom IN ('Y', 'N')),
  CONSTRAINT fc_vlsf_unique UNIQUE (order_date, order_date_la, item_category, channel, order_type, link_master_sku)
);

CREATE INDEX IF NOT EXISTS idx_vlsf_main  ON shipcore.fc_velocity_link_snapshot_forecast (item_category, channel, order_type, order_date);
CREATE INDEX IF NOT EXISTS idx_vlsf_sku   ON shipcore.fc_velocity_link_snapshot_forecast (link_master_sku);
CREATE INDEX IF NOT EXISTS idx_vlsf_la    ON shipcore.fc_velocity_link_snapshot_forecast (item_category, channel, order_type, order_date_la);
