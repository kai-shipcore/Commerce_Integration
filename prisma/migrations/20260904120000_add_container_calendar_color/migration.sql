ALTER TABLE shipcore.fc_containers
  ADD COLUMN IF NOT EXISTS calendar_color VARCHAR(7);

