ALTER TABLE shipcore.fc_products
  ADD COLUMN IF NOT EXISTS total_avg_prev_override NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS total_avg_real_override NUMERIC(14,4);
