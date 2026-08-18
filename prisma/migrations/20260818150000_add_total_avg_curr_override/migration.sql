-- Keep the calculated T. Avg current value in fc_stats and store only an
-- explicit user override on the product master. NULL means "use auto value".
ALTER TABLE shipcore.fc_products
  ADD COLUMN IF NOT EXISTS total_avg_curr_override NUMERIC(14,4);
