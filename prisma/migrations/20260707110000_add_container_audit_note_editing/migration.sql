-- Add soft-delete and edit metadata for manual container history notes.

ALTER TABLE shipcore.fc_container_audit_log
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_fc_container_audit_log_active_notes
  ON shipcore.fc_container_audit_log (container_id, created_at DESC)
  WHERE deleted_at IS NULL;
