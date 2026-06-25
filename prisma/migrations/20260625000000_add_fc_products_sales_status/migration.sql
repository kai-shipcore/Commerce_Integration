-- Add sales_status column to fc_products so it can be edited directly in SKU Master.
-- Dashboard query will prefer this value over fc_stats.sales_status via COALESCE.
ALTER TABLE shipcore.fc_products
  ADD COLUMN IF NOT EXISTS sales_status VARCHAR(20) NULL;
