ALTER TABLE shipcore.fc_planning_stats_refresh_jobs
  ADD COLUMN IF NOT EXISTS requested_by TEXT
    REFERENCES shipcore.fc_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source VARCHAR(200) NOT NULL DEFAULT 'planning-stats-refresh-api',
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE INDEX IF NOT EXISTS idx_fc_planning_stats_refresh_jobs_requested_by
  ON shipcore.fc_planning_stats_refresh_jobs (requested_by);

CREATE INDEX IF NOT EXISTS idx_fc_planning_stats_refresh_jobs_correlation_id
  ON shipcore.fc_planning_stats_refresh_jobs (correlation_id);
