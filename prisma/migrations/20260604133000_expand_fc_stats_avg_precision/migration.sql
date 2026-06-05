ALTER TABLE shipcore.fc_stats
  ALTER COLUMN avg_daily_prev TYPE NUMERIC(12, 6),
  ALTER COLUMN avg_daily_real TYPE NUMERIC(12, 6),
  ALTER COLUMN avg_daily_curr TYPE NUMERIC(12, 6),
  ALTER COLUMN east_avg_prev TYPE NUMERIC(12, 6),
  ALTER COLUMN east_avg_real TYPE NUMERIC(12, 6),
  ALTER COLUMN east_avg_curr TYPE NUMERIC(12, 6),
  ALTER COLUMN fba_avg_real TYPE NUMERIC(12, 6),
  ALTER COLUMN fba_avg_curr TYPE NUMERIC(12, 6),
  ALTER COLUMN total_avg_prev TYPE NUMERIC(12, 6),
  ALTER COLUMN total_avg_real TYPE NUMERIC(12, 6),
  ALTER COLUMN total_avg_curr TYPE NUMERIC(12, 6);

ALTER TABLE shipcore.fc_stats_custom
  ALTER COLUMN avg_daily_prev TYPE NUMERIC(12, 6),
  ALTER COLUMN avg_daily_real TYPE NUMERIC(12, 6),
  ALTER COLUMN avg_daily_curr TYPE NUMERIC(12, 6),
  ALTER COLUMN east_avg_prev TYPE NUMERIC(12, 6),
  ALTER COLUMN east_avg_real TYPE NUMERIC(12, 6),
  ALTER COLUMN east_avg_curr TYPE NUMERIC(12, 6),
  ALTER COLUMN fba_avg_real TYPE NUMERIC(12, 6),
  ALTER COLUMN fba_avg_curr TYPE NUMERIC(12, 6),
  ALTER COLUMN total_avg_prev TYPE NUMERIC(12, 6),
  ALTER COLUMN total_avg_real TYPE NUMERIC(12, 6),
  ALTER COLUMN total_avg_curr TYPE NUMERIC(12, 6);
