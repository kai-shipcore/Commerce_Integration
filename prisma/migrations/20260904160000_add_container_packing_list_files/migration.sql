CREATE TABLE IF NOT EXISTS shipcore.fc_container_packing_list_files (
  id BIGSERIAL PRIMARY KEY,
  container_id BIGINT NOT NULL UNIQUE
    REFERENCES shipcore.fc_containers(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  file_data BYTEA NOT NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
