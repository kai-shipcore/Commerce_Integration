-- Structured breakdown for standardized seat-cover Part catalog entries.
ALTER TABLE shipcore.fc_production_parts ADD COLUMN IF NOT EXISTS seat_row TEXT;
ALTER TABLE shipcore.fc_production_parts ADD COLUMN IF NOT EXISTS "position" TEXT;
ALTER TABLE shipcore.fc_production_parts ADD COLUMN IF NOT EXISTS category TEXT;
