-- Drop is_custom_sku from fc_products.
-- Custom/Original distinction is derived entirely from fc_stats.sales_status
-- and fc_stats_custom.sales_status, which are populated by the stats refresh
-- job using fc_velocity_*_snapshot.is_custom from the Supabase source views.
ALTER TABLE shipcore.fc_products DROP COLUMN IF EXISTS is_custom_sku;
