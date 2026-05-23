-- Planning Dashboard Tables
-- Schema: shipcore (must already exist)
-- Run once to create tables; safe to re-run (IF NOT EXISTS)
--
-- Tables:
--   1. shipcore.fc_planning_containers        — active container metadata
--   2. shipcore.fc_planning_sku_rows          — main SKU demand data
--   3. shipcore.fc_planning_sku_container_data — per-SKU × per-container cross data
--
-- How table 3 joins:
--   fc_planning_sku_container_data.sku_row_id   → fc_planning_sku_rows.id   (integer)
--   fc_planning_sku_container_data.container_id → fc_planning_containers.id (integer)

-- ─────────────────────────────────────────────────────────────
-- 1. Containers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipcore.fc_planning_containers (
    id          SERIAL         PRIMARY KEY,
    name        VARCHAR(64)    NOT NULL UNIQUE,   -- e.g. "167-CA-SEAT"
    col         INTEGER        NOT NULL,          -- column sort order in dashboard
    eta         DATE           NOT NULL,
    cbm_cap     NUMERIC(8, 2)  NOT NULL DEFAULT 0,
    is_active   BOOLEAN        NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shipcore.fc_planning_containers IS
    'Active inbound containers shown as column groups in the planning dashboard.';

-- ─────────────────────────────────────────────────────────────
-- 2. SKU demand rows
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipcore.fc_planning_sku_rows (
    id                 SERIAL         PRIMARY KEY,
    sku                VARCHAR(128)   NOT NULL UNIQUE,

    -- Core identifiers
    container_info     TEXT,
    cbm                NUMERIC(10, 6),
    seat               VARCHAR(8),
    no                 SMALLINT,
    color              VARCHAR(16),
    tone               VARCHAR(16),
    back               INTEGER        NOT NULL DEFAULT 0,
    sales_status       VARCHAR(16)    NOT NULL DEFAULT 'Original'
                           CHECK (sales_status IN ('Original', 'Custom', 'Hold')),

    -- Inventory snapshot
    west_stock         INTEGER        NOT NULL DEFAULT 0,
    east_stock         INTEGER        NOT NULL DEFAULT 0,
    total_stock        INTEGER        NOT NULL DEFAULT 0,

    -- West FBM sales (units sold)
    west_90d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_60d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_30d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_15d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_7d            NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_30d_pre       NUMERIC(10, 2) NOT NULL DEFAULT 0,

    -- East FBM sales (units sold)
    east_90d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_60d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_30d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_15d           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_7d            NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_30d_pre       NUMERIC(10, 2) NOT NULL DEFAULT 0,

    -- West avg daily velocity
    avg_daily_prev     NUMERIC(8, 2),
    avg_daily_real     NUMERIC(8, 2),
    avg_daily_curr     NUMERIC(8, 2),

    -- East avg daily velocity
    east_avg_prev      NUMERIC(8, 2),
    east_avg_real      NUMERIC(8, 2),
    east_avg_curr      NUMERIC(8, 2),

    -- FBA avg daily
    fba_avg_real       NUMERIC(8, 2),
    fba_avg_curr       NUMERIC(8, 2),

    -- 30-day sales breakdown
    west_fbm_30d       INTEGER        NOT NULL DEFAULT 0,
    east_fbm_30d       INTEGER        NOT NULL DEFAULT 0,
    fba_30d            INTEGER        NOT NULL DEFAULT 0,
    total_30d          INTEGER        NOT NULL DEFAULT 0,

    -- Total avg daily
    total_avg_prev     NUMERIC(8, 2),
    total_avg_real     NUMERIC(8, 2),
    total_avg_curr     NUMERIC(8, 2),

    -- Inbound / SOD summary
    total_inbound_qty  INTEGER,
    containers_list    TEXT,            -- e.g. "167 (200), 168 (50)"
    next_eta           DATE,
    sod                DATE,            -- Stock-Out Date estimate

    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shipcore.fc_planning_sku_rows IS
    'One row per active SKU. Upsert in-place when refreshing data.';
COMMENT ON COLUMN shipcore.fc_planning_sku_rows.sod IS
    'Estimated stock-out date. Used for urgency coloring (crit ≤30d, warn ≤60d).';

CREATE INDEX IF NOT EXISTS idx_fc_planning_sku_rows_sod
    ON shipcore.fc_planning_sku_rows (sod);

CREATE INDEX IF NOT EXISTS idx_fc_planning_sku_rows_status
    ON shipcore.fc_planning_sku_rows (sales_status);

-- ─────────────────────────────────────────────────────────────
-- 3. Per-SKU × per-container cross data
--    Joins to tables 1 and 2 via integer IDs.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipcore.fc_planning_sku_container_data (
    id             SERIAL      PRIMARY KEY,
    sku_row_id     INTEGER     NOT NULL
                       REFERENCES shipcore.fc_planning_sku_rows (id)
                       ON DELETE CASCADE,
    container_id   INTEGER     NOT NULL
                       REFERENCES shipcore.fc_planning_containers (id)
                       ON DELETE CASCADE,

    open_orders    INTEGER,
    avail_qty      INTEGER,
    est_sales      INTEGER,
    backorder      INTEGER,
    eta            DATE,
    inv_life       NUMERIC(8, 2),
    est_sod        DATE,
    plan_sod       DATE,
    cbm            NUMERIC(10, 4),

    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (sku_row_id, container_id)
);

COMMENT ON TABLE shipcore.fc_planning_sku_container_data IS
    'Per-SKU inventory/SOD data broken down by container. One row per (sku_row_id, container_id).';

CREATE INDEX IF NOT EXISTS idx_fc_planning_sku_container_data_sku
    ON shipcore.fc_planning_sku_container_data (sku_row_id);

CREATE INDEX IF NOT EXISTS idx_fc_planning_sku_container_data_con
    ON shipcore.fc_planning_sku_container_data (container_id);

-- ─────────────────────────────────────────────────────────────
-- Upsert helpers
-- ─────────────────────────────────────────────────────────────
-- Upsert a container (conflict on name):
--   INSERT INTO shipcore.fc_planning_containers (name, col, eta, cbm_cap)
--   VALUES ('167-CA-SEAT', 83, '2026-05-29', 80.91)
--   ON CONFLICT (name) DO UPDATE SET
--     col = EXCLUDED.col, eta = EXCLUDED.eta,
--     cbm_cap = EXCLUDED.cbm_cap, updated_at = NOW();

-- Upsert a SKU row (conflict on sku):
--   INSERT INTO shipcore.fc_planning_sku_rows (sku, west_stock, east_stock, ...)
--   VALUES ('CA-SC-10-F-10-BK-1TO', 756, 263, ...)
--   ON CONFLICT (sku) DO UPDATE SET
--     west_stock = EXCLUDED.west_stock, ..., updated_at = NOW();

-- Upsert cross data (look up IDs by name/sku first, then conflict on the pair):
--   INSERT INTO shipcore.fc_planning_sku_container_data
--     (sku_row_id, container_id, avail_qty, ...)
--   SELECT r.id, c.id, 200, ...
--   FROM shipcore.fc_planning_sku_rows r
--   JOIN shipcore.fc_planning_containers c ON c.name = '167-CA-SEAT'
--   WHERE r.sku = 'CA-SC-10-F-10-BK-1TO'
--   ON CONFLICT (sku_row_id, container_id) DO UPDATE SET
--     avail_qty = EXCLUDED.avail_qty, ..., updated_at = NOW();
