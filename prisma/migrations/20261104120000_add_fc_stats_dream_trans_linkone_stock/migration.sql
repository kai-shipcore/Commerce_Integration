-- Two warehouses appeared in Supabase coverland_inventory_by_warehouse
-- (Dream Trans, Linkone) that the stats refresh counted into total_stock but
-- into neither west_stock nor east_stock. Both are West; store them per
-- warehouse like the other four.
ALTER TABLE shipcore.fc_stats
  ADD COLUMN IF NOT EXISTS dream_trans_stock           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linkone_stock               INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dream_trans_available_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linkone_available_stock     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE shipcore.fc_stats_custom
  ADD COLUMN IF NOT EXISTS dream_trans_stock           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linkone_stock               INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dream_trans_available_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linkone_available_stock     INTEGER NOT NULL DEFAULT 0;
