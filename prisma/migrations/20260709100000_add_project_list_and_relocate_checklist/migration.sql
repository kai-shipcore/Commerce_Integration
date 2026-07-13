-- Project List: per-vehicle configuration tracking. Relocates the checklist
-- feature from Part SKU (fc_part_sku_checklist_items) onto Project instead.

DROP TABLE IF EXISTS shipcore.fc_part_sku_checklist_items;

CREATE TABLE IF NOT EXISTS shipcore.fc_projects (
  id                     BIGSERIAL PRIMARY KEY,
  make                   TEXT NOT NULL,
  model                  TEXT NOT NULL,
  f_number               TEXT NOT NULL,
  year_generation        TEXT,
  researched_by_user_id  TEXT REFERENCES shipcore.fc_user(id) ON DELETE SET NULL,
  reviewed_by_user_id    TEXT REFERENCES shipcore.fc_user(id) ON DELETE SET NULL,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_projects_make_model ON shipcore.fc_projects (make, model);
CREATE INDEX IF NOT EXISTS idx_fc_projects_f_number ON shipcore.fc_projects (f_number);
CREATE INDEX IF NOT EXISTS idx_fc_projects_is_active ON shipcore.fc_projects (is_active);

CREATE TABLE IF NOT EXISTS shipcore.fc_project_parts (
  id                    BIGSERIAL PRIMARY KEY,
  project_id            BIGINT NOT NULL REFERENCES shipcore.fc_projects(id) ON DELETE CASCADE,
  seat_row              TEXT NOT NULL,
  cab                   TEXT,
  configuration         TEXT,
  code                  TEXT,
  status                TEXT NOT NULL DEFAULT 'Pending',
  assigned_to_user_id   TEXT REFERENCES shipcore.fc_user(id) ON DELETE SET NULL,
  photo_count           INTEGER NOT NULL DEFAULT 0,
  doc_url               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_project_parts_project_id ON shipcore.fc_project_parts (project_id);
CREATE INDEX IF NOT EXISTS idx_fc_project_parts_status ON shipcore.fc_project_parts (status);
CREATE INDEX IF NOT EXISTS idx_fc_project_parts_assigned_to_user_id ON shipcore.fc_project_parts (assigned_to_user_id);

CREATE TABLE IF NOT EXISTS shipcore.fc_project_checklist_items (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES shipcore.fc_projects(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_project_checklist_items_project_id ON shipcore.fc_project_checklist_items (project_id);
