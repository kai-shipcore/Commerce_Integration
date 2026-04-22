--==============================================
-- STEP 1: Sync AND Update Products
--==============================================
INSERT INTO shipcore.sc_products (
    master_sku,
    product_name,
    status,
    updated_at
)
SELECT DISTINCT
    master_sku,
    'Product ' || master_sku,
    'active',
    NOW()
FROM ecommerce_data.coverland_inventory
ON CONFLICT (master_sku)
DO UPDATE SET
    product_name = EXCLUDED.product_name,
    status = EXCLUDED.status,
    updated_at = NOW();

--==============================================
-- STEP 2: Sync AND Update Warehouses
--==============================================
INSERT INTO shipcore.sc_warehouses (
    warehouse_code,
    warehouse_name,
    warehouse_type,
    is_active,
    updated_at
)
SELECT DISTINCT
    warehouse,
    warehouse || ' Warehouse',
    '3PL',
    true,
    NOW()
FROM ecommerce_data.coverland_inventory
ON CONFLICT (warehouse_code)
DO UPDATE SET
    warehouse_name = EXCLUDED.warehouse_name,
    warehouse_type = EXCLUDED.warehouse_type,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

--==============================================
-- STEP 3: Refresh Inventory Snapshot, Truncate first and Insert
--==============================================
TRUNCATE TABLE shipcore.sc_inventory_snapshot;

INSERT INTO shipcore.sc_inventory_snapshot (
    master_sku,
    warehouse_code,
    on_hand_qty,
    available_qty,
    backorder_qty,
    reserved_qty,
    manual_adjustment_qty,
    final_usable_qty,
    created_at,
    snapshot_at
)
SELECT
    master_sku,
    warehouse,
    COALESCE(on_hand, 0),
    COALESCE(available, 0),
    COALESCE(backorder, 0),
    0,
    0,
    COALESCE(available, 0),
    created_at,
    NOW()
FROM ecommerce_data.coverland_inventory;
