-- Migration: Add container audit log table
-- Tracks who changed what on a container, when, and before/after values.

CREATE TABLE IF NOT EXISTS shipcore.fc_container_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  container_id     BIGINT NOT NULL,
  container_number TEXT,
  user_id          TEXT,
  user_name        TEXT,
  user_email       TEXT,
  action           TEXT NOT NULL,
  before           JSONB,
  after            JSONB,
  note             TEXT,
  ip               TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_container_audit_log_container_id
  ON shipcore.fc_container_audit_log (container_id);

CREATE INDEX IF NOT EXISTS idx_fc_container_audit_log_created_at
  ON shipcore.fc_container_audit_log (created_at DESC);
