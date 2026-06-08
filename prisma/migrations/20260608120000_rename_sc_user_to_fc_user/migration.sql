DO $$
BEGIN
  IF to_regclass('shipcore.fc_user') IS NULL
     AND to_regclass('shipcore.sc_user') IS NOT NULL THEN
    ALTER TABLE shipcore.sc_user RENAME TO fc_user;
  END IF;
END $$;
