-- Google-Sheets-style tabs for the Demand Planning grid.
--
-- A "tab" is either the Live tab (no row here — the real fc_container_items /
-- fc_containers data, exactly as before) or a scenario: a saved view plus an
-- overlay of container quantities and ETAs that is never written back to the
-- real container tables until it is explicitly applied.

CREATE TABLE IF NOT EXISTS shipcore.fc_planning_scenarios (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  owner_user_id TEXT        NOT NULL,
  visibility    TEXT        NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','shared')),
  -- Non-null means the tab is locked for editing. Only the lock holder, the
  -- owner, or an admin may write to it or release the lock.
  locked_by     TEXT        NULL,
  locked_at     TIMESTAMPTZ NULL,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  color         TEXT        NULL,
  -- The whole preference blob the dashboard already builds in one place:
  -- filters, sort, column visibility/order/widths, colors, formats,
  -- conditional rules, seasonal factors, sales-window weights, gradients.
  view_state    JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fc_planning_scenarios_owner
  ON shipcore.fc_planning_scenarios (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_fc_planning_scenarios_shared
  ON shipcore.fc_planning_scenarios (visibility)
  WHERE visibility = 'shared';

-- Per-scenario container quantities.
--
-- A row present with qty = 0 means "this scenario deliberately puts nothing in
-- that container" — it is an explicit value, not an absence. Only the absence
-- of a row falls back to the Live quantity.
--
-- container_id carries no FK on purpose: a container leaving the inbound set
-- (completed, or deleted) must not silently CASCADE a scenario's numbers away.
-- Reads join against the current container list and ignore orphans.
CREATE TABLE IF NOT EXISTS shipcore.fc_planning_scenario_items (
  scenario_id  BIGINT      NOT NULL
               REFERENCES shipcore.fc_planning_scenarios(id) ON DELETE CASCADE,
  container_id BIGINT      NOT NULL,
  master_sku   TEXT        NOT NULL,
  qty          INTEGER     NOT NULL CHECK (qty >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scenario_id, container_id, master_sku)
);

-- Per-scenario container-level overrides. Only the ETA today; the table exists
-- so the next one does not need a migration of its own.
CREATE TABLE IF NOT EXISTS shipcore.fc_planning_scenario_containers (
  scenario_id  BIGINT      NOT NULL
               REFERENCES shipcore.fc_planning_scenarios(id) ON DELETE CASCADE,
  container_id BIGINT      NOT NULL,
  eta_date     DATE        NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scenario_id, container_id)
);
