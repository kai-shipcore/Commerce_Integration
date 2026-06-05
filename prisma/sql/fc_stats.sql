-- fc_stats
-- Schema: shipcore
-- One row per master_sku. Holds pre-calculated sales velocity and inventory
-- stats that are too expensive to compute per request.
--
-- Relationship to other tables:
--   master_sku is a soft reference to fc_container_items.master_sku and
--   fc_products.master_sku — intentionally NO foreign key so the table can
--   be empty or partially populated without breaking anything. The dashboard
--   API LEFT JOINs this table; missing rows simply render as zeros.
--
-- Populated by: POST /api/planning/stats/refresh (Phase 2)
-- Run once to create; safe to re-run (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS shipcore.fc_stats (
    id             SERIAL          PRIMARY KEY,
    master_sku     VARCHAR(128)    NOT NULL UNIQUE,

    -- Sales status — placeholder until sourced from a real table (Phase 2+)
    -- Values: 'Original' | 'Custom' | 'Hold'
    sales_status   VARCHAR(16)     NOT NULL DEFAULT 'Original'
                       CHECK (sales_status IN ('Original', 'Custom', 'Hold')),

    -- Backorder qty — populated from ecommerce_data.coverland_inventory.backorder
    back           INTEGER         NOT NULL DEFAULT 0,

    -- Inventory snapshot (from ShipHero or equivalent)
    west_stock     INTEGER         NOT NULL DEFAULT 0,
    east_stock     INTEGER         NOT NULL DEFAULT 0,
    total_stock    INTEGER         NOT NULL DEFAULT 0,

    -- West FBM sales (units sold per lookback window)
    west_90d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_60d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_30d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_15d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_7d        NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_30d_pre   NUMERIC(10, 2)  NOT NULL DEFAULT 0,

    -- East FBM sales
    east_90d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_60d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_30d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_15d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_7d        NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_30d_pre   NUMERIC(10, 2)  NOT NULL DEFAULT 0,

    -- West avg daily velocity (prev = prior period, real = trailing, curr = recent)
    avg_daily_prev NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    avg_daily_real NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    avg_daily_curr NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    -- East avg daily velocity
    east_avg_prev  NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    east_avg_real  NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    east_avg_curr  NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    -- FBA avg daily
    fba_avg_real   NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    fba_avg_curr   NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    -- 30-day sales breakdown by channel
    west_fbm_30d   INTEGER         NOT NULL DEFAULT 0,
    east_fbm_30d   INTEGER         NOT NULL DEFAULT 0,
    fba_30d        INTEGER         NOT NULL DEFAULT 0,
    total_30d      INTEGER         NOT NULL DEFAULT 0,

    -- Total avg daily
    total_avg_prev NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    total_avg_real NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    total_avg_curr NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    -- Timestamp of last stats calculation run
    -- NULL means this row has never been calculated (shows zeros on dashboard)
    calculated_at  TIMESTAMPTZ,

    created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shipcore.fc_stats IS
    'Pre-calculated sales velocity and inventory stats per SKU. '
    'LEFT JOIN to fc_container_items on master_sku. Empty rows are fine — '
    'dashboard shows zeros until Phase 2 refresh populates this table.';

COMMENT ON COLUMN shipcore.fc_stats.calculated_at IS
    'NULL = never calculated. Non-null = last time the refresh endpoint ran for this SKU.';

CREATE INDEX IF NOT EXISTS idx_fc_stats_master_sku
    ON shipcore.fc_stats (master_sku);

-- Upsert pattern used by the refresh endpoint (Phase 2):
--   INSERT INTO shipcore.fc_stats (master_sku, west_stock, avg_daily_curr, ...)
--   VALUES (...)
--   ON CONFLICT (master_sku) DO UPDATE SET
--     west_stock     = EXCLUDED.west_stock,
--     avg_daily_curr = EXCLUDED.avg_daily_curr,
--     ...
--     calculated_at  = NOW(),
--     updated_at     = NOW();
