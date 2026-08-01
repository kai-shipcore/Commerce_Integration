-- Technical API error log. This is intentionally separate from fc_audit_log,
-- which records user/business changes rather than application failures.
CREATE TABLE IF NOT EXISTS shipcore.fc_api_error_logs (
  id           BIGSERIAL PRIMARY KEY,
  request_id   UUID         NOT NULL,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  method       VARCHAR(10),
  pathname     TEXT,
  status_code  SMALLINT     NOT NULL CHECK (status_code BETWEEN 500 AND 599),
  error_code   VARCHAR(64)  NOT NULL,
  error_name   VARCHAR(128) NOT NULL,
  message      TEXT         NOT NULL,
  stack        TEXT,
  user_id      TEXT,
  duration_ms  INTEGER      NOT NULL DEFAULT 0,
  metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS fc_api_error_logs_occurred_at_idx
  ON shipcore.fc_api_error_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS fc_api_error_logs_request_id_idx
  ON shipcore.fc_api_error_logs (request_id);
CREATE INDEX IF NOT EXISTS fc_api_error_logs_status_path_idx
  ON shipcore.fc_api_error_logs (status_code, pathname, occurred_at DESC);
