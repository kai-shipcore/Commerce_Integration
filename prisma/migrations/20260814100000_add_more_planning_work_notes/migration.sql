-- Add two independent workflow-note slots beside the existing Note column.
ALTER TABLE shipcore.fc_planning_sku_work_notes
  ALTER COLUMN note DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS note_2 TEXT,
  ADD COLUMN IF NOT EXISTS note_3 TEXT;
