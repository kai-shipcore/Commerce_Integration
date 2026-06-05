-- fc_pin_containers
-- Schema: shipcore
-- Per-container inbound quantities for pinned reference rows.
-- Intentionally uses different column names from fc_containers / fc_container_items
-- so there is zero risk of overlap or accidental joins.
--
-- Each row represents one container's inbound qty for one pinned row.
-- The dashboard route uses this table instead of fc_container_items
-- when building the chain for a pinned row.
--
-- To remove:  DELETE FROM shipcore.fc_pin_containers WHERE pin_id = <id>;
-- To drop:    DROP TABLE shipcore.fc_pin_containers;

CREATE TABLE IF NOT EXISTS shipcore.fc_pin_containers (
    id             SERIAL          PRIMARY KEY,
    pin_id         INTEGER         NOT NULL
                     REFERENCES shipcore.fc_pinned_rows(id) ON DELETE CASCADE,
    container_ref  VARCHAR(128)    NOT NULL,   -- matches fc_containers.container_number
    arrives_on     DATE            NOT NULL,   -- matches fc_containers.eta_date
    test_qty       INTEGER         NOT NULL DEFAULT 0,
    test_cbm_unit  NUMERIC(10, 4)  NOT NULL DEFAULT 0,
    UNIQUE (pin_id, container_ref)
);

COMMENT ON TABLE shipcore.fc_pin_containers IS
    'Test inbound quantities per container for fc_pinned_rows reference rows. '
    'Uses distinct column names (container_ref, arrives_on, test_qty) to avoid '
    'accidental overlap with fc_containers / fc_container_items.';

-- ── Test data: 170-CA-SEAT for pin_id=1 (CA-SC-10-F-10-BK-1TO Ref) ─────────
INSERT INTO shipcore.fc_pin_containers (pin_id, container_ref, arrives_on, test_qty)
VALUES (1, '170-CA-SEAT', '2026-06-09', 175)
ON CONFLICT (pin_id, container_ref) DO UPDATE
  SET arrives_on = EXCLUDED.arrives_on,
      test_qty   = EXCLUDED.test_qty;
