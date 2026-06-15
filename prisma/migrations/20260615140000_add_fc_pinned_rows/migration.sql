CREATE TABLE IF NOT EXISTS shipcore.fc_pinned_rows (
    id              SERIAL PRIMARY KEY,
    master_sku      VARCHAR(128) NOT NULL,
    label           TEXT NOT NULL DEFAULT 'Ref',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    back            INTEGER NOT NULL DEFAULT 0,
    west_stock      INTEGER NOT NULL DEFAULT 0,
    east_stock      INTEGER NOT NULL DEFAULT 0,
    total_stock     INTEGER NOT NULL DEFAULT 0,
    west_90d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_60d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_30d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_15d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_7d         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    west_30d_pre    NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_90d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_60d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_30d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_15d        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_7d         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    east_30d_pre    NUMERIC(10, 2) NOT NULL DEFAULT 0,
    fba_30d         INTEGER NOT NULL DEFAULT 0,
    avg_daily_prev  NUMERIC(12, 6) NOT NULL DEFAULT 0,
    east_avg_prev   NUMERIC(12, 6) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM shipcore.fc_pinned_rows keep
USING shipcore.fc_pinned_rows duplicate
WHERE keep.master_sku = duplicate.master_sku
  AND keep.label = duplicate.label
  AND keep.id > duplicate.id;

CREATE UNIQUE INDEX IF NOT EXISTS fc_pinned_rows_master_sku_label_key
ON shipcore.fc_pinned_rows (master_sku, label);

CREATE TABLE IF NOT EXISTS shipcore.fc_pin_containers (
    id             SERIAL PRIMARY KEY,
    pin_id         INTEGER NOT NULL REFERENCES shipcore.fc_pinned_rows(id) ON DELETE CASCADE,
    container_ref  VARCHAR(128) NOT NULL,
    arrives_on     DATE NOT NULL,
    test_qty       INTEGER NOT NULL DEFAULT 0,
    test_cbm_unit  NUMERIC(10, 4) NOT NULL DEFAULT 0,
    UNIQUE (pin_id, container_ref)
);

COMMENT ON TABLE shipcore.fc_pinned_rows IS
    'Reference/sample rows pinned to the planning dashboard for calculation verification.';

COMMENT ON TABLE shipcore.fc_pin_containers IS
    'Test inbound quantities per container for fc_pinned_rows reference rows.';

WITH upsert_pin AS (
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
  ON CONFLICT (master_sku, label) DO UPDATE
    SET sort_order = EXCLUDED.sort_order,
        back = EXCLUDED.back,
        total_stock = EXCLUDED.total_stock,
        west_stock = EXCLUDED.west_stock,
        east_stock = EXCLUDED.east_stock,
        west_90d = EXCLUDED.west_90d,
        west_60d = EXCLUDED.west_60d,
        west_30d = EXCLUDED.west_30d,
        west_15d = EXCLUDED.west_15d,
        west_7d = EXCLUDED.west_7d,
        west_30d_pre = EXCLUDED.west_30d_pre,
        east_90d = EXCLUDED.east_90d,
        east_60d = EXCLUDED.east_60d,
        east_30d = EXCLUDED.east_30d,
        east_15d = EXCLUDED.east_15d,
        east_7d = EXCLUDED.east_7d,
        east_30d_pre = EXCLUDED.east_30d_pre,
        fba_30d = EXCLUDED.fba_30d,
        avg_daily_prev = EXCLUDED.avg_daily_prev,
        east_avg_prev = EXCLUDED.east_avg_prev,
        updated_at = NOW()
  RETURNING id
)
INSERT INTO shipcore.fc_pin_containers (pin_id, container_ref, arrives_on, test_qty)
SELECT id, '170-CA-SEAT', '2026-06-09'::date, 175
FROM upsert_pin
ON CONFLICT (pin_id, container_ref) DO UPDATE
  SET arrives_on = EXCLUDED.arrives_on,
      test_qty = EXCLUDED.test_qty;
