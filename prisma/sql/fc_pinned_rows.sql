-- fc_pinned_rows
-- Schema: shipcore
-- Reference / sample rows pinned to the top of the planning dashboard.
--
-- ONLY raw input data is stored here. All derived velocity averages,
-- 30-day totals, and chain values are computed at runtime by the same
-- formulas used for fc_stats rows. Nothing here touches fc_stats or
-- fc_products — safe to DROP TABLE when no longer needed.
--
-- To remove a pinned row:  DELETE FROM shipcore.fc_pinned_rows WHERE id = <id>;
-- To remove all:           DELETE FROM shipcore.fc_pinned_rows;
-- To drop the feature:     DROP TABLE shipcore.fc_pinned_rows;

CREATE TABLE IF NOT EXISTS shipcore.fc_pinned_rows (
    id            SERIAL          PRIMARY KEY,
    master_sku    VARCHAR(128)    NOT NULL,
    label         TEXT            NOT NULL DEFAULT 'Ref',
    sort_order    INTEGER         NOT NULL DEFAULT 0,

    -- Inventory snapshot
    back          INTEGER         NOT NULL DEFAULT 0,
    west_stock    INTEGER         NOT NULL DEFAULT 0,
    east_stock    INTEGER         NOT NULL DEFAULT 0,
    total_stock   INTEGER         NOT NULL DEFAULT 0,

    -- Raw velocity windows — west FBM
    west_90d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_60d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_30d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_15d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_7d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    west_30d_pre  NUMERIC(10, 2)  NOT NULL DEFAULT 0,

    -- Raw velocity windows — east TTM
    east_90d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_60d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_30d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_15d      NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_7d       NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    east_30d_pre  NUMERIC(10, 2)  NOT NULL DEFAULT 0,

    -- FBA
    fba_30d       INTEGER         NOT NULL DEFAULT 0,

    -- Previous period averages (cannot be derived from current windows alone)
    avg_daily_prev  NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    east_avg_prev   NUMERIC(12, 6)  NOT NULL DEFAULT 0,

    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shipcore.fc_pinned_rows IS
    'Reference/sample rows pinned to the top of the planning dashboard. '
    'Stores only raw inputs; derived velocity and chain values are computed '
    'at runtime using the same formulas as fc_stats. '
    'Does not affect fc_stats or fc_products.';

-- ── Sample row: CA-SC-10-F-10-BK-1TO reference data ────────────────────────
-- Run this INSERT to add the reference row.
-- Remove with:  DELETE FROM shipcore.fc_pinned_rows WHERE master_sku = 'CA-SC-10-F-10-BK-1TO' AND label = 'Ref';

INSERT INTO shipcore.fc_pinned_rows
  (master_sku, label, sort_order,
   back, total_stock, west_stock, east_stock,
   west_90d, west_60d, west_30d, west_15d, west_7d, west_30d_pre,
   east_90d, east_60d, east_30d, east_15d, east_7d, east_30d_pre,
   fba_30d,
   avg_daily_prev, east_avg_prev)
VALUES
  ('CA-SC-10-F-10-BK-1TO', 'Ref', 0,
   -10, 879, 0, 0,
   1443, 841, 434, 213, 104, 26,
   447, 427, 239, 111, 51, 2,
   0,
   13.22, 5.853370)
ON CONFLICT DO NOTHING;
