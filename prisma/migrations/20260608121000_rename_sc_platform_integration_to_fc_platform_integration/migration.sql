DO $$
BEGIN
  IF to_regclass('shipcore.fc_platform_integration') IS NULL
     AND to_regclass('shipcore.sc_platform_integration') IS NOT NULL THEN
    ALTER TABLE shipcore.sc_platform_integration RENAME TO fc_platform_integration;
  END IF;
END $$;
