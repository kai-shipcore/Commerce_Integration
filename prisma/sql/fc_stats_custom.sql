-- fc_stats_custom
-- Schema: shipcore
-- Mirror of fc_stats, populated entirely from fc_velocity_custom_snapshot for ALL SKUs.
-- fc_stats uses fc_velocity_link_snapshot; fc_stats_custom uses fc_velocity_custom_snapshot.
-- The planning dashboard switches between these two tables via the Link/Custom toggle.
--
-- Populated by: POST /api/planning/stats/refresh (same endpoint as fc_stats)
-- Run once to create; safe to re-run (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS shipcore.fc_stats_custom (
    id             SERIAL          PRIMARY KEY,
    master_sku     VARCHAR(128)    NOT NULL UNIQUE,

    sales_status   VARCHAR(16)     NOT NULL DEFAULT 'Original'
                       CHECK (sales_status IN ('Original', 'Custom', 'Hold')),

    back           INTEGER         NOT NULL DEFAULT 0,

    west_stock     INTEGER         NOT NULL DEFAULT 0,
    east_stock     INTEGER         NOT NULL DEFAULT 0,
    total_stock    INTEGER         NOT NULL DEFAULT 0,

    west_90d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_60d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_30d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_15d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_7d        NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_30d_pre   NUMERIC(10, 2)  NOT NULL DEFAULT 0,

    east_90d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_60d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_30d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_15d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_7d        NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_30d_pre   NUMERIC(10, 2)  NOT NULL DEFAULT 0,

    avg_daily_prev NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    avg_daily_real NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    avg_daily_curr NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    east_avg_prev  NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    east_avg_real  NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    east_avg_curr  NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    fba_avg_prev   NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    fba_avg_real   NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    fba_avg_curr   NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    west_fbm_30d   INTEGER         NOT NULL DEFAULT 0,
    east_fbm_30d   INTEGER         NOT NULL DEFAULT 0,
    fba_30d        INTEGER         NOT NULL DEFAULT 0,
    total_30d      INTEGER         NOT NULL DEFAULT 0,

    total_avg_prev NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    total_avg_real NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    total_avg_curr NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    calculated_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shipcore.fc_stats_custom IS
    'Same schema as fc_stats. Velocity sourced from fc_velocity_custom_snapshot for all SKUs. '
    'Planning dashboard uses this table when mode=custom is selected.';

CREATE INDEX IF NOT EXISTS idx_fc_stats_custom_master_sku
    ON shipcore.fc_stats_custom (master_sku);
