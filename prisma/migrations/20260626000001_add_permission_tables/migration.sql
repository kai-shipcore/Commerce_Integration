CREATE TABLE IF NOT EXISTS shipcore.role_permissions (
  role    TEXT NOT NULL,
  section TEXT NOT NULL,
  action  TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (role, section, action)
);

CREATE TABLE IF NOT EXISTS shipcore.user_permission_overrides (
  user_id TEXT NOT NULL,
  section TEXT NOT NULL,
  action  TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, section, action)
);
