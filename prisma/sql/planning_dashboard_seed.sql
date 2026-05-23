-- Planning Dashboard — Sample Data
-- Run AFTER planning_dashboard.sql has been executed.
-- Safe to re-run; all inserts use ON CONFLICT ... DO UPDATE.

-- ─────────────────────────────────────────────────────────────
-- 1. Containers
-- ─────────────────────────────────────────────────────────────
INSERT INTO shipcore.fc_planning_containers (name, col, eta, cbm_cap, is_active)
VALUES
    ('166-CA-SEAT', 63,  '2026-05-15', 80.60,  true),
    ('165-CA-SEAT', 73,  '2026-05-21', 80.34,  true),
    ('168-CA-SEAT', 93,  '2026-05-21', 80.94,  true),
    ('167-CA-SEAT', 83,  '2026-05-29', 80.91,  true),
    ('169-CA-SEAT', 103, '2026-05-29', 76.05,  true),
    ('170-CA-SEAT', 113, '2026-06-09', 81.83,  true)
ON CONFLICT (name) DO UPDATE SET
    col        = EXCLUDED.col,
    eta        = EXCLUDED.eta,
    cbm_cap    = EXCLUDED.cbm_cap,
    is_active  = EXCLUDED.is_active,
    updated_at = NOW();

-- ─────────────────────────────────────────────────────────────
-- 2. SKU rows
-- ─────────────────────────────────────────────────────────────
INSERT INTO shipcore.fc_planning_sku_rows (
    sku, container_info, cbm, seat, no, color, tone, back, sales_status,
    west_stock, east_stock, total_stock,
    west_90d, west_60d, west_30d, west_15d, west_7d, west_30d_pre,
    east_90d, east_60d, east_30d, east_15d, east_7d, east_30d_pre,
    avg_daily_prev, avg_daily_real, avg_daily_curr,
    east_avg_prev, east_avg_real, east_avg_curr,
    fba_avg_real, fba_avg_curr,
    west_fbm_30d, east_fbm_30d, fba_30d, total_30d,
    total_avg_prev, total_avg_real, total_avg_curr,
    total_inbound_qty, containers_list, next_eta, sod
)
VALUES
    (
        'CA-SC-10-F-10-BK-1TO',
        '4/21/2026 - (159-CA-SEAT) - 60', 0.048852, 'F', 10, 'BK', '1TO',
        -6, 'Original',
        756, 263, 1019,
        1733, 1005, 443, 264, 119, 17,
        0, 283, 218, 117, 70, 0,
        14.12, 14.99, 14.91,
        4.44, 5.95, 5.80,
        0.01, 0.01,
        516, 179, 0, 695,
        18.57, 20.95, 20.71,
        1710, '167 (200), 168 (50), 169 (50), 170 (175)', '2026-05-29', '2026-07-02'
    ),
    (
        'CA-SC-10-F-10-GY-1TO',
        '4/21/2026 - (159-CA-SEAT) - 30', 0.048852, 'F', 10, 'GY', '1TO',
        0, 'Original',
        412, 145, 557,
        890, 540, 230, 130, 58, 10,
        0, 140, 105, 55, 32, 0,
        9.78, 10.12, 9.95,
        2.80, 3.50, 3.30,
        0.00, 0.00,
        230, 105, 0, 335,
        12.58, 13.62, 13.25,
        820, '167 (100), 169 (80), 170 (100)', '2026-05-29', '2026-07-20'
    ),
    (
        'CA-SC-10-F-10-BG-1TO',
        '4/21/2026 - (159-CA-SEAT) - 20', 0.048852, 'F', 10, 'BG', '1TO',
        0, 'Custom',
        198, 74, 272,
        420, 260, 115, 62, 28, 5,
        0, 68, 52, 27, 15, 0,
        4.42, 4.85, 4.70,
        1.40, 1.78, 1.65,
        0.00, 0.00,
        115, 52, 0, 167,
        5.82, 6.63, 6.35,
        350, '168 (50), 170 (75)', '2026-05-21', '2026-08-05'
    ),
    (
        'CA-FM-10-F-10-BK',
        '3/15/2026 - (158-CA-SEAT) - 40', 0.125000, 'F', 10, 'BK', NULL,
        2, 'Original',
        320, 110, 430,
        680, 420, 185, 98, 44, 8,
        0, 95, 72, 38, 21, 0,
        7.12, 7.58, 7.40,
        1.95, 2.40, 2.25,
        0.01, 0.01,
        185, 72, 1, 258,
        9.07, 9.98, 9.65,
        480, '167 (120), 169 (60)', '2026-05-29', '2026-07-15'
    ),
    (
        'CA-SC-10-F-10-BK-2TO',
        '4/21/2026 - (159-CA-SEAT) - 15', 0.048852, 'F', 10, 'BK', '2TO',
        -2, 'Original',
        88, 32, 120,
        310, 190, 82, 45, 20, 4,
        0, 55, 40, 22, 12, 0,
        3.22, 3.55, 3.42,
        1.10, 1.38, 1.28,
        0.00, 0.00,
        82, 40, 0, 122,
        4.32, 4.93, 4.70,
        240, '166 (60), 168 (40), 170 (80)', '2026-05-15', '2026-06-15'
    ),
    (
        'CA-SC-10-F-10-TN-1TO',
        '4/21/2026 - (159-CA-SEAT) - 10', 0.048852, 'F', 10, 'TN', '1TO',
        0, 'Hold',
        45, 18, 63,
        125, 78, 32, 17, 8, 2,
        0, 22, 16, 9, 5, 0,
        1.28, 1.38, 1.32,
        0.45, 0.58, 0.52,
        0.00, 0.00,
        32, 16, 0, 48,
        1.73, 1.96, 1.84,
        0, NULL, NULL, '2026-06-28'
    )
ON CONFLICT (sku) DO UPDATE SET
    container_info     = EXCLUDED.container_info,
    cbm                = EXCLUDED.cbm,
    seat               = EXCLUDED.seat,
    no                 = EXCLUDED.no,
    color              = EXCLUDED.color,
    tone               = EXCLUDED.tone,
    back               = EXCLUDED.back,
    sales_status       = EXCLUDED.sales_status,
    west_stock         = EXCLUDED.west_stock,
    east_stock         = EXCLUDED.east_stock,
    total_stock        = EXCLUDED.total_stock,
    west_90d           = EXCLUDED.west_90d,
    west_60d           = EXCLUDED.west_60d,
    west_30d           = EXCLUDED.west_30d,
    west_15d           = EXCLUDED.west_15d,
    west_7d            = EXCLUDED.west_7d,
    west_30d_pre       = EXCLUDED.west_30d_pre,
    east_90d           = EXCLUDED.east_90d,
    east_60d           = EXCLUDED.east_60d,
    east_30d           = EXCLUDED.east_30d,
    east_15d           = EXCLUDED.east_15d,
    east_7d            = EXCLUDED.east_7d,
    east_30d_pre       = EXCLUDED.east_30d_pre,
    avg_daily_prev     = EXCLUDED.avg_daily_prev,
    avg_daily_real     = EXCLUDED.avg_daily_real,
    avg_daily_curr     = EXCLUDED.avg_daily_curr,
    east_avg_prev      = EXCLUDED.east_avg_prev,
    east_avg_real      = EXCLUDED.east_avg_real,
    east_avg_curr      = EXCLUDED.east_avg_curr,
    fba_avg_real       = EXCLUDED.fba_avg_real,
    fba_avg_curr       = EXCLUDED.fba_avg_curr,
    west_fbm_30d       = EXCLUDED.west_fbm_30d,
    east_fbm_30d       = EXCLUDED.east_fbm_30d,
    fba_30d            = EXCLUDED.fba_30d,
    total_30d          = EXCLUDED.total_30d,
    total_avg_prev     = EXCLUDED.total_avg_prev,
    total_avg_real     = EXCLUDED.total_avg_real,
    total_avg_curr     = EXCLUDED.total_avg_curr,
    total_inbound_qty  = EXCLUDED.total_inbound_qty,
    containers_list    = EXCLUDED.containers_list,
    next_eta           = EXCLUDED.next_eta,
    sod                = EXCLUDED.sod,
    updated_at         = NOW();

-- ─────────────────────────────────────────────────────────────
-- 3. Cross data  (sku_row_id + container_id resolved by subquery)
-- ─────────────────────────────────────────────────────────────
INSERT INTO shipcore.fc_planning_sku_container_data
    (sku_row_id, container_id, open_orders, avail_qty, est_sales, backorder, eta, inv_life, est_sod, plan_sod, cbm)
SELECT r.id, c.id, v.open_orders, v.avail_qty, v.est_sales, v.backorder,
       v.eta::date, v.inv_life, v.est_sod::date, v.plan_sod::date, v.cbm
FROM (VALUES
    -- sku,                    container,       oo, avail, est,  bo,  eta,          life,  est_sod,       plan_sod,      cbm
    ('CA-SC-10-F-10-BK-1TO',  '166-CA-SEAT',    0, 1013,   0,   0,  '2026-05-15', 48.9,  '2026-07-02',  '2026-07-02',  0.0),
    ('CA-SC-10-F-10-BK-1TO',  '167-CA-SEAT',    0,  200, 210,   0,  '2026-05-29', 58.2,  '2026-07-27',  '2026-07-27',  9.7),
    ('CA-SC-10-F-10-BK-1TO',  '168-CA-SEAT',    0,   50,  52,   0,  '2026-05-21', 51.3,  '2026-07-11',  '2026-07-11',  2.4),
    ('CA-SC-10-F-10-BK-1TO',  '169-CA-SEAT',    0,   50,  52,   0,  '2026-05-29', 52.1,  '2026-07-19',  '2026-07-19',  2.4),
    ('CA-SC-10-F-10-BK-1TO',  '170-CA-SEAT',    0,  175, 183,   0,  '2026-06-09', 60.7,  '2026-08-08',  '2026-08-08',  8.5),

    ('CA-SC-10-F-10-GY-1TO',  '166-CA-SEAT',    0,  557,   0,   0,  '2026-05-15', 41.9,  '2026-07-05',  '2026-07-05',  0.0),
    ('CA-SC-10-F-10-GY-1TO',  '167-CA-SEAT',    0,  100, 104,   0,  '2026-05-29', 49.8,  '2026-07-17',  '2026-07-17',  4.9),
    ('CA-SC-10-F-10-GY-1TO',  '169-CA-SEAT',    0,   80,  83,   0,  '2026-05-29', 47.3,  '2026-07-15',  '2026-07-15',  3.9),
    ('CA-SC-10-F-10-GY-1TO',  '170-CA-SEAT',    0,  100, 104,   0,  '2026-06-09', 55.2,  '2026-07-25',  '2026-07-25',  4.9),

    ('CA-SC-10-F-10-BG-1TO',  '168-CA-SEAT',    0,   50,  51,   0,  '2026-05-21', 43.1,  '2026-07-05',  '2026-07-05',  2.4),
    ('CA-SC-10-F-10-BG-1TO',  '170-CA-SEAT',    0,   75,  78,   0,  '2026-06-09', 55.0,  '2026-07-27',  '2026-07-27',  3.7),

    ('CA-FM-10-F-10-BK',      '167-CA-SEAT',    0,  120, 114,   0,  '2026-05-29', 52.4,  '2026-07-19',  '2026-07-19', 15.0),
    ('CA-FM-10-F-10-BK',      '169-CA-SEAT',    0,   60,  57,   0,  '2026-05-29', 46.7,  '2026-07-13',  '2026-07-13',  7.5),

    ('CA-SC-10-F-10-BK-2TO',  '166-CA-SEAT',    0,   60,  62,   2,  '2026-05-15', 28.5,  '2026-06-13',  '2026-06-13',  2.9),
    ('CA-SC-10-F-10-BK-2TO',  '168-CA-SEAT',    0,   40,  41,   0,  '2026-05-21', 34.2,  '2026-06-24',  '2026-06-24',  1.9),
    ('CA-SC-10-F-10-BK-2TO',  '170-CA-SEAT',    0,   80,  83,   0,  '2026-06-09', 45.8,  '2026-07-24',  '2026-07-24',  3.9)
) AS v(sku, container, open_orders, avail_qty, est_sales, backorder, eta, inv_life, est_sod, plan_sod, cbm)
JOIN shipcore.fc_planning_sku_rows       r ON r.sku  = v.sku
JOIN shipcore.fc_planning_containers     c ON c.name = v.container
ON CONFLICT (sku_row_id, container_id) DO UPDATE SET
    open_orders  = EXCLUDED.open_orders,
    avail_qty    = EXCLUDED.avail_qty,
    est_sales    = EXCLUDED.est_sales,
    backorder    = EXCLUDED.backorder,
    eta          = EXCLUDED.eta,
    inv_life     = EXCLUDED.inv_life,
    est_sod      = EXCLUDED.est_sod,
    plan_sod     = EXCLUDED.plan_sod,
    cbm          = EXCLUDED.cbm,
    updated_at   = NOW();

-- ─────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────
SELECT 'fc_planning_containers'      AS table_name, COUNT(*)::int AS rows FROM shipcore.fc_planning_containers
UNION ALL
SELECT 'fc_planning_sku_rows',                       COUNT(*)::int         FROM shipcore.fc_planning_sku_rows
UNION ALL
SELECT 'fc_planning_sku_container_data',             COUNT(*)::int         FROM shipcore.fc_planning_sku_container_data;
