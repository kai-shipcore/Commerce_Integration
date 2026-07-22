-- SWC SKU convention changed from CA-{fabric}-SWC-{rest}
-- to CA-SWC-{fabric}-{rest}. Foreign keys referencing fc_products use
-- ON UPDATE CASCADE; soft-reference stats and velocity tables are updated here.

-- A sync running during rollout may have already created normalized placeholder
-- rows. Prefer the established legacy rows (which contain the maintained SKU
-- settings and full stats), then rename those rows below.
DELETE FROM shipcore.fc_stats target
WHERE EXISTS (
  SELECT 1
  FROM shipcore.fc_stats legacy
  WHERE legacy.master_sku ~ '^CA-[^-]+-SWC-.+$'
    AND target.master_sku = regexp_replace(legacy.master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
);

DELETE FROM shipcore.fc_stats_custom target
WHERE EXISTS (
  SELECT 1
  FROM shipcore.fc_stats_custom legacy
  WHERE legacy.master_sku ~ '^CA-[^-]+-SWC-.+$'
    AND target.master_sku = regexp_replace(legacy.master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
);

DELETE FROM shipcore.fc_products target
WHERE EXISTS (
  SELECT 1
  FROM shipcore.fc_products legacy
  WHERE legacy.master_sku ~ '^CA-[^-]+-SWC-.+$'
    AND target.master_sku = regexp_replace(legacy.master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
);

UPDATE shipcore.fc_products
SET product_name = CASE
      WHEN product_name = master_sku
        THEN regexp_replace(product_name, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
      ELSE product_name
    END,
    master_sku = regexp_replace(master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2'),
    updated_at = NOW()
WHERE master_sku ~ '^CA-[^-]+-SWC-.+$';

UPDATE shipcore.fc_stats
SET master_sku = regexp_replace(master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2'),
    updated_at = NOW()
WHERE master_sku ~ '^CA-[^-]+-SWC-.+$';

UPDATE shipcore.fc_stats_custom
SET master_sku = regexp_replace(master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2'),
    updated_at = NOW()
WHERE master_sku ~ '^CA-[^-]+-SWC-.+$';

UPDATE shipcore.fc_velocity_link_snapshot
SET link_master_sku = regexp_replace(link_master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
WHERE link_master_sku ~ '^CA-[^-]+-SWC-.+$';

UPDATE shipcore.fc_velocity_custom_snapshot
SET custom_master_sku = regexp_replace(custom_master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
WHERE custom_master_sku ~ '^CA-[^-]+-SWC-.+$';

UPDATE shipcore.fc_velocity_link_snapshot_forecast
SET link_master_sku = regexp_replace(link_master_sku, '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\1-\2')
WHERE link_master_sku ~ '^CA-[^-]+-SWC-.+$';
