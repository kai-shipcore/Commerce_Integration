-- Promote SWC from a sales_status tag layered on top of category_code='CC' to its own real
-- category_code value. Every code path that read category_code IN ('CC','FM') / === 'CC' to decide
-- stats source, OOS weight bucket, sales-history table, or SKU Forecasts tab has been updated in the
-- same change to explicitly treat 'SWC' like 'CC' for those internal calculations, so this is purely
-- a re-labeling of the stored category_code/category text — no other computed values should change.
--
-- src/app/api/planning/stats/refresh/route.ts's recurring "Step 3" sync job (runs on every dashboard
-- Sync click) has also been updated to write 'SWC' instead of 'CC' going forward, so this one-time
-- backfill won't be silently reverted on the next sync.
UPDATE shipcore.fc_products
SET category_code = 'SWC', category = 'SWC', updated_at = NOW()
WHERE master_sku ILIKE '%SWC%' AND category_code = 'CC';
