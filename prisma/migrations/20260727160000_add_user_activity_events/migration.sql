-- Detailed user activity timeline. Stores navigation and meaningful UI actions
-- without recording form values, search terms, or input contents.

CREATE TABLE shipcore.fc_user_activity_event (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES shipcore.fc_user(id) ON DELETE CASCADE,
  occurred_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  path TEXT,
  label TEXT,
  target TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX fc_user_activity_event_user_occurred_at_idx
  ON shipcore.fc_user_activity_event (user_id, occurred_at DESC);

CREATE INDEX fc_user_activity_event_occurred_at_idx
  ON shipcore.fc_user_activity_event (occurred_at);
