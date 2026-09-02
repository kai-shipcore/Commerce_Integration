-- Drop the LA order-date column from the velocity snapshots.
--
-- WHY
-- ---
-- Velocity offered a UTC/LA toggle while Demand Planning always aggregated on
-- order_date (UTC). Same SKU, same period, different numbers — which is how a
-- support question about CA-SC-10-F-10-BK-1TO (Velocity 138 vs DP 121 for
-- 8/24-8/30) came in. Five of those units were nothing but the timezone.
-- LA-based reporting is no longer wanted, so the choice is removed rather than
-- documented.
--
-- This removes only the *order date* alternative. The planning business day
-- (planningLocalDateString) stays on America/Los_Angeles: that is the
-- warehouse's working day, not a display option.
--
-- WHY THE MERGE STEP
-- ------------------
-- The unique key loses a column, so rows that differ only by LA date now
-- collide (one UTC date can carry two LA dates — 44% of rows sit on a
-- different day under the two clocks). Those rows are folded together first,
-- summing the quantity, which is exactly what a fresh sync would produce for
-- the narrower key. No data is dropped and no re-sync is required: the tables
-- stay queryable throughout and the next regular Sync maintains them.
--
-- Dry-run against production before writing this (row counts drift as syncs
-- run, quantities are the point):
--   link      111,934 -> 95,142 rows   qty 158,847 -> 158,847
--   custom    113,021 -> 96,374 rows   qty 158,878 -> 158,878
--   forecast  220,321 -> 186,936 rows  qty 329,905 -> 329,905
--
-- is_custom is in the sync's GROUP BY but not in this key. Two source rows
-- differing only in is_custom would therefore collide on upsert — checked
-- across both views over the full 120-day sync window and it does not occur
-- (0 groups), so the fold below cannot mix Y with N.

-- ─── fc_velocity_link_snapshot ──────────────────────────────────────────
WITH merged AS (
  SELECT MIN(id) AS keep_id, SUM(link_qty) AS total_qty, MAX(synced_at) AS synced_at
  FROM shipcore.fc_velocity_link_snapshot
  GROUP BY order_date, item_category, channel, order_type, link_master_sku
  HAVING COUNT(*) > 1
)
UPDATE shipcore.fc_velocity_link_snapshot t
   SET link_qty = m.total_qty, synced_at = m.synced_at
  FROM merged m
 WHERE t.id = m.keep_id;

DELETE FROM shipcore.fc_velocity_link_snapshot t
 USING (
   SELECT id, ROW_NUMBER() OVER (
            PARTITION BY order_date, item_category, channel, order_type, link_master_sku
            ORDER BY id
          ) AS rn
     FROM shipcore.fc_velocity_link_snapshot
 ) d
 WHERE t.id = d.id AND d.rn > 1;

DROP INDEX IF EXISTS shipcore.vls_cat_ch_type_date_la_idx;
ALTER TABLE shipcore.fc_velocity_link_snapshot
  DROP CONSTRAINT IF EXISTS velocity_link_snapshot_unique;
ALTER TABLE shipcore.fc_velocity_link_snapshot
  DROP COLUMN IF EXISTS order_date_la;
ALTER TABLE shipcore.fc_velocity_link_snapshot
  ADD CONSTRAINT velocity_link_snapshot_unique
  UNIQUE (order_date, item_category, channel, order_type, link_master_sku);

-- ─── fc_velocity_custom_snapshot ────────────────────────────────────────
WITH merged AS (
  SELECT MIN(id) AS keep_id, SUM(custom_qty) AS total_qty, MAX(synced_at) AS synced_at
  FROM shipcore.fc_velocity_custom_snapshot
  GROUP BY order_date, item_category, channel, order_type, custom_master_sku
  HAVING COUNT(*) > 1
)
UPDATE shipcore.fc_velocity_custom_snapshot t
   SET custom_qty = m.total_qty, synced_at = m.synced_at
  FROM merged m
 WHERE t.id = m.keep_id;

DELETE FROM shipcore.fc_velocity_custom_snapshot t
 USING (
   SELECT id, ROW_NUMBER() OVER (
            PARTITION BY order_date, item_category, channel, order_type, custom_master_sku
            ORDER BY id
          ) AS rn
     FROM shipcore.fc_velocity_custom_snapshot
 ) d
 WHERE t.id = d.id AND d.rn > 1;

DROP INDEX IF EXISTS shipcore.vcs_cat_ch_type_date_la_idx;
ALTER TABLE shipcore.fc_velocity_custom_snapshot
  DROP CONSTRAINT IF EXISTS velocity_custom_snapshot_unique;
ALTER TABLE shipcore.fc_velocity_custom_snapshot
  DROP COLUMN IF EXISTS order_date_la;
ALTER TABLE shipcore.fc_velocity_custom_snapshot
  ADD CONSTRAINT velocity_custom_snapshot_unique
  UNIQUE (order_date, item_category, channel, order_type, custom_master_sku);

-- ─── fc_velocity_link_snapshot_forecast ─────────────────────────────────
-- Not in schema.prisma: created by 20260708120000_add_velocity_forecast_snapshot
-- and written through the same upsertLinkSnapshot helper, so it has to move too.
WITH merged AS (
  SELECT MIN(id) AS keep_id, SUM(link_qty) AS total_qty, MAX(synced_at) AS synced_at
  FROM shipcore.fc_velocity_link_snapshot_forecast
  GROUP BY order_date, item_category, channel, order_type, link_master_sku
  HAVING COUNT(*) > 1
)
UPDATE shipcore.fc_velocity_link_snapshot_forecast t
   SET link_qty = m.total_qty, synced_at = m.synced_at
  FROM merged m
 WHERE t.id = m.keep_id;

DELETE FROM shipcore.fc_velocity_link_snapshot_forecast t
 USING (
   SELECT id, ROW_NUMBER() OVER (
            PARTITION BY order_date, item_category, channel, order_type, link_master_sku
            ORDER BY id
          ) AS rn
     FROM shipcore.fc_velocity_link_snapshot_forecast
 ) d
 WHERE t.id = d.id AND d.rn > 1;

DROP INDEX IF EXISTS shipcore.idx_vlsf_la;
ALTER TABLE shipcore.fc_velocity_link_snapshot_forecast
  DROP CONSTRAINT IF EXISTS fc_vlsf_unique;
ALTER TABLE shipcore.fc_velocity_link_snapshot_forecast
  DROP COLUMN IF EXISTS order_date_la;
ALTER TABLE shipcore.fc_velocity_link_snapshot_forecast
  ADD CONSTRAINT fc_vlsf_unique
  UNIQUE (order_date, item_category, channel, order_type, link_master_sku);
