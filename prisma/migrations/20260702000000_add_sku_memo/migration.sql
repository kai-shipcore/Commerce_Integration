-- Add memo field to fc_products for per-SKU notes in the demand planning dashboard.
ALTER TABLE shipcore.fc_products ADD COLUMN IF NOT EXISTS memo TEXT;
