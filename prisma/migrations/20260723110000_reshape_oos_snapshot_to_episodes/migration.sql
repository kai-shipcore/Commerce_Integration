-- fc_inventory_history_snapshot was just introduced (20260723090000) as a raw daily
-- copy of ecommerce_data.vw_coverland_inventory_history. Reshaping it to store OOS
-- episodes (start/end date pairs) instead — far fewer rows, and the 90-day rollup
-- becomes a simple date-range overlap sum instead of a generate_series/forward-fill.
-- Table has no real consumers yet, so drop + recreate rather than migrate in place.
DROP TABLE IF EXISTS shipcore.fc_inventory_history_snapshot;

CREATE TABLE shipcore.fc_inventory_history_snapshot (
    id               SERIAL PRIMARY KEY,
    master_sku       VARCHAR(128) NOT NULL,
    oos_started_on   DATE         NOT NULL,
    back_in_stock_on DATE,                    -- NULL = still OOS as of the latest sync
    synced_at        TIMESTAMPTZ  NOT NULL,
    UNIQUE (master_sku, oos_started_on)
);

CREATE INDEX idx_fc_inv_hist_snapshot_sku
    ON shipcore.fc_inventory_history_snapshot (master_sku);
