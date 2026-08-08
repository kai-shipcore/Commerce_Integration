CREATE TABLE IF NOT EXISTS shipcore.fc_planning_stats_refresh_jobs (
  id UUID PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_planning_stats_refresh_jobs_one_active
  ON shipcore.fc_planning_stats_refresh_jobs ((1))
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_fc_planning_stats_refresh_jobs_created_at
  ON shipcore.fc_planning_stats_refresh_jobs (created_at DESC);
