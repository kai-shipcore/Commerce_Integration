-- Restore fc_designer_initials (dropped in 20260708090000, reinstated after reconsidering).
CREATE TABLE IF NOT EXISTS shipcore.fc_designer_initials (
  id            BIGSERIAL PRIMARY KEY,
  initial       TEXT NOT NULL,
  designer_name TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_designer_initials_initial_key UNIQUE (initial)
);

CREATE INDEX IF NOT EXISTS idx_fc_designer_initials_initial ON shipcore.fc_designer_initials (initial);
CREATE INDEX IF NOT EXISTS idx_fc_designer_initials_is_active ON shipcore.fc_designer_initials (is_active);
