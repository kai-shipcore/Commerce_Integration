ALTER TABLE shipcore.fc_containers
  ADD COLUMN IF NOT EXISTS est_loading_date DATE,
  ADD COLUMN IF NOT EXISTS etd_ngb_date DATE,
  ADD COLUMN IF NOT EXISTS eta_lax_lgb_date DATE;
