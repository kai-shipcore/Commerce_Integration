-- Creates a generalized audit log table for tracking changes to factories,
-- warehouses, SKU master, user permissions/roles, and integration configurations.
-- The existing fc_container_audit_log remains unchanged for container-specific logs.

CREATE TABLE IF NOT EXISTS shipcore.fc_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  VARCHAR(50)  NOT NULL,  -- factory | warehouse | sku | user_permission | user_role | integration
  entity_id    TEXT         NOT NULL,  -- primary key of the affected entity (as string)
  entity_label TEXT,                   -- human-readable name (factory name, warehouse code, SKU, user email, platform)
  user_id      TEXT,
  user_name    TEXT,
  user_email   TEXT,
  action       TEXT         NOT NULL,  -- create | update | delete | status_change | permission_grant | permission_revoke | role_change | config_update
  before       JSONB,
  after        JSONB,
  note         TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fc_audit_log_entity_idx    ON shipcore.fc_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS fc_audit_log_user_idx      ON shipcore.fc_audit_log (user_id);
CREATE INDEX IF NOT EXISTS fc_audit_log_created_idx   ON shipcore.fc_audit_log (created_at DESC);
