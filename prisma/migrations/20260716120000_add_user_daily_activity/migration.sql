-- Track actual application usage separately from authentication history.
-- One row per user and application-local calendar date is updated by a
-- throttled heartbeat while the authenticated application is in use.

CREATE TABLE shipcore.fc_user_daily_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES shipcore.fc_user(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  first_seen_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  activity_count INTEGER NOT NULL DEFAULT 1,
  last_path TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX fc_user_daily_activity_user_date_key
  ON shipcore.fc_user_daily_activity (user_id, activity_date);

CREATE INDEX fc_user_daily_activity_activity_date_idx
  ON shipcore.fc_user_daily_activity (activity_date);

CREATE INDEX fc_user_daily_activity_last_seen_at_idx
  ON shipcore.fc_user_daily_activity (last_seen_at);
