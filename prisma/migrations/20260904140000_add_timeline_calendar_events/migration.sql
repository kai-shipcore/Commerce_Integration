CREATE TABLE IF NOT EXISTS shipcore.fc_timeline_calendar_events (
  id              BIGSERIAL PRIMARY KEY,
  title           VARCHAR(160) NOT NULL,
  event_date      DATE NOT NULL,
  calendar_color  VARCHAR(7) NOT NULL DEFAULT '#4285F4',
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_timeline_calendar_events_color_ck
    CHECK (calendar_color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_fc_timeline_calendar_events_date
  ON shipcore.fc_timeline_calendar_events (event_date, id);
