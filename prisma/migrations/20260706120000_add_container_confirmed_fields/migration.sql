ALTER TABLE shipcore.fc_containers
  ADD COLUMN IF NOT EXISTS confirmed_date DATE,
  ADD COLUMN IF NOT EXISTS confirmed_time TIME;
