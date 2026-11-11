-- Amazon FBA sales per web SKU (the marketplace order SKU, vw_sales_order_items_*.order_sku)
-- for the Velocity page's "Web SKU" view. fc_velocity_link_snapshot / _custom_snapshot
-- aggregate to master SKU and drop the web SKU, so this table carries it for FBA only
-- (Amazon FBA USA / Amazon FBA Canada). Filled by the same Velocity sync, from the same
-- WHERE filters, so per master SKU it sums to the FBA rows of those two tables.
--
-- source: 'link' rows come from vw_sales_order_items_link_new (master_sku = link master),
--         'custom' rows from vw_sales_order_items_custom_new (master_sku = custom master).
CREATE TABLE IF NOT EXISTS shipcore.fc_velocity_fba_web_sku_snapshot (
  id            SERIAL      PRIMARY KEY,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        TEXT        NOT NULL CHECK (source IN ('link', 'custom')),
  order_date    DATE        NOT NULL,
  item_category TEXT        NOT NULL,
  channel       TEXT        NOT NULL,
  order_type    TEXT        NOT NULL,
  web_sku       TEXT        NOT NULL,
  master_sku    TEXT        NOT NULL,
  qty           INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT fc_vfws_unique UNIQUE (source, order_date, item_category, channel, order_type, web_sku, master_sku)
);

CREATE INDEX IF NOT EXISTS idx_vfws_main ON shipcore.fc_velocity_fba_web_sku_snapshot (source, item_category, channel, order_type, order_date);
