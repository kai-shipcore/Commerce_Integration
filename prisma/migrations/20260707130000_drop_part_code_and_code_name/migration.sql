-- fc_production_parts: drop part_code, part_name becomes the unique identifier.
ALTER TABLE shipcore.fc_production_parts DROP CONSTRAINT IF EXISTS fc_production_parts_part_code_key;
DROP INDEX IF EXISTS shipcore.idx_fc_production_parts_part_code;
ALTER TABLE shipcore.fc_production_parts DROP COLUMN IF EXISTS part_code;
ALTER TABLE shipcore.fc_production_parts ADD CONSTRAINT fc_production_parts_part_name_key UNIQUE (part_name);
CREATE INDEX IF NOT EXISTS idx_fc_production_parts_part_name ON shipcore.fc_production_parts (part_name);

-- fc_production_codes: drop name, description remains alongside code.
ALTER TABLE shipcore.fc_production_codes DROP COLUMN IF EXISTS name;
