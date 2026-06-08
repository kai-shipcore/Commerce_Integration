DO $$
BEGIN
  IF to_regclass('shipcore.fc_velocity_link_snapshot') IS NULL
     AND to_regclass('shipcore.velocity_link_snapshot') IS NOT NULL THEN
    ALTER TABLE shipcore.velocity_link_snapshot RENAME TO fc_velocity_link_snapshot;
  END IF;

  IF to_regclass('shipcore.fc_velocity_custom_snapshot') IS NULL
     AND to_regclass('shipcore.velocity_custom_snapshot') IS NOT NULL THEN
    ALTER TABLE shipcore.velocity_custom_snapshot RENAME TO fc_velocity_custom_snapshot;
  END IF;
END $$;
