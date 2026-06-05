-- User preferences table: stores per-user UI settings (column visibility, colors, etc.)
-- keyed by (user_id, key) so each setting bucket is independently updatable.

CREATE TABLE IF NOT EXISTS shipcore.fc_user_preferences (
  user_id    TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_fc_user_preferences_user_id
  ON shipcore.fc_user_preferences (user_id);
