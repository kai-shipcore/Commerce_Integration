-- Independent Production master-data lookups: Parts, Codes, Designer Initials.

CREATE TABLE IF NOT EXISTS shipcore.fc_production_parts (
  id          BIGSERIAL PRIMARY KEY,
  part_code   TEXT NOT NULL,
  part_name   TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_production_parts_part_code_key UNIQUE (part_code)
);

CREATE INDEX IF NOT EXISTS idx_fc_production_parts_part_code ON shipcore.fc_production_parts (part_code);
CREATE INDEX IF NOT EXISTS idx_fc_production_parts_is_active ON shipcore.fc_production_parts (is_active);

CREATE TABLE IF NOT EXISTS shipcore.fc_production_codes (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_production_codes_code_key UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_fc_production_codes_code ON shipcore.fc_production_codes (code);
CREATE INDEX IF NOT EXISTS idx_fc_production_codes_is_active ON shipcore.fc_production_codes (is_active);

CREATE TABLE IF NOT EXISTS shipcore.fc_designer_initials (
  id            BIGSERIAL PRIMARY KEY,
  initial       TEXT NOT NULL,
  designer_name TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_designer_initials_initial_key UNIQUE (initial)
);

CREATE INDEX IF NOT EXISTS idx_fc_designer_initials_initial ON shipcore.fc_designer_initials (initial);
CREATE INDEX IF NOT EXISTS idx_fc_designer_initials_is_active ON shipcore.fc_designer_initials (is_active);
