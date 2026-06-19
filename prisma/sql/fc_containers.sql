-- fc_containers, fc_container_items, fc_container_po_links
-- Schema: shipcore
-- Run once to create; safe to re-run (IF NOT EXISTS)

DO $$ BEGIN
  CREATE TYPE shipcore.fc_container_status AS ENUM ('draft', 'shipped', 'packing_received', 'received');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS shipcore.fc_containers (
  id                  BIGSERIAL       PRIMARY KEY,
  container_number    VARCHAR(64)     NOT NULL,
  eta_date            DATE,
  actual_arrival_date DATE,
  status              shipcore.fc_container_status NOT NULL DEFAULT 'draft',
  cbm_capacity        NUMERIC(8, 2)   NOT NULL DEFAULT 67.5,
  factory_name        VARCHAR(128),
  origin              VARCHAR(128),
  dest_warehouse      VARCHAR(128),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_containers_number_uk UNIQUE (container_number)
);

CREATE TABLE IF NOT EXISTS shipcore.fc_container_items (
  id           BIGSERIAL     PRIMARY KEY,
  container_id BIGINT        NOT NULL REFERENCES shipcore.fc_containers(id) ON DELETE CASCADE,
  master_sku   VARCHAR(128)  NOT NULL,
  qty          INTEGER       NOT NULL,
  cbm_unit     NUMERIC(14, 6),
  total_cbm    NUMERIC(14, 6),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_container_items_container
  ON shipcore.fc_container_items (container_id);

CREATE TABLE IF NOT EXISTS shipcore.fc_container_po_links (
  container_id BIGINT NOT NULL REFERENCES shipcore.fc_containers(id) ON DELETE CASCADE,
  po_id        BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (container_id, po_id)
);
