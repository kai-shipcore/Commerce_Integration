-- Short, shared workflow labels used by the Planning dashboard Note column.
-- Kept separate from the existing long-form SKU memo so either can be
-- cleared independently.
CREATE TABLE IF NOT EXISTS shipcore.fc_planning_sku_work_notes (
  master_sku  TEXT PRIMARY KEY,
  note        TEXT NOT NULL,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_planning_sku_work_notes_updated_at
  ON shipcore.fc_planning_sku_work_notes (updated_at DESC);
