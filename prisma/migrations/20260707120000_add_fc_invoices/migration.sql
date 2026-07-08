-- Invoice Review feature: fc_invoices, fc_invoice_items, fc_invoice_audit_log.
-- Follows the fc_sku_price_history / fc_price_list_files precedent (20260706130000):
-- raw-SQL managed tables, no Prisma Client model, accessed only via pg Pool.

DO $$ BEGIN
  CREATE TYPE shipcore.fc_invoice_status AS ENUM (
    'received', 'price_review', 'discrepancy_found',
    'factory_confirmation', 'approved', 'signed', 'sent_to_factory'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipcore.fc_invoice_item_result AS ENUM (
    'match', 'price_error', 'overcharged', 'no_price_history'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS shipcore.fc_invoices (
  id                        BIGSERIAL PRIMARY KEY,
  invoice_number            TEXT NOT NULL,
  factory_id                BIGINT NOT NULL REFERENCES shipcore.fc_factories(id),
  container_id              BIGINT REFERENCES shipcore.fc_containers(id) ON DELETE SET NULL,
  container_number          TEXT,
  invoice_date              DATE NOT NULL,
  status                    shipcore.fc_invoice_status NOT NULL DEFAULT 'received',
  attachment_file_id        BIGINT REFERENCES shipcore.fc_price_list_files(id) ON DELETE SET NULL,
  signed_attachment_file_id BIGINT REFERENCES shipcore.fc_price_list_files(id) ON DELETE SET NULL,
  signed_by                 TEXT,
  signed_at                 TIMESTAMPTZ,
  last_compared_at          TIMESTAMPTZ,
  last_compared_by          TEXT,
  note                      TEXT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_invoices_factory_number_uk UNIQUE (factory_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_fc_invoices_status       ON shipcore.fc_invoices (status);
CREATE INDEX IF NOT EXISTS idx_fc_invoices_factory_id   ON shipcore.fc_invoices (factory_id);
CREATE INDEX IF NOT EXISTS idx_fc_invoices_container_id ON shipcore.fc_invoices (container_id);

CREATE TABLE IF NOT EXISTS shipcore.fc_invoice_items (
  id                            BIGSERIAL PRIMARY KEY,
  invoice_id                    BIGINT NOT NULL REFERENCES shipcore.fc_invoices(id) ON DELETE CASCADE,
  sku                           TEXT NOT NULL,
  qty                           INTEGER NOT NULL CHECK (qty > 0),
  invoice_unit_price            NUMERIC(14,4) NOT NULL CHECK (invoice_unit_price >= 0),
  -- Denormalized snapshot of the comparison result (recomputed on add/import/recompare):
  expected_unit_price           NUMERIC(14,4),
  expected_effective_date       DATE,
  price_history_id              BIGINT REFERENCES shipcore.fc_sku_price_history(id) ON DELETE SET NULL,
  diff_unit_price                NUMERIC(14,4),
  result                        shipcore.fc_invoice_item_result NOT NULL DEFAULT 'no_price_history',
  -- Inline credit tracking (no separate ledger table this phase):
  credit_status                 TEXT CHECK (credit_status IN ('requested','confirmed','applied')),
  credit_amount                 NUMERIC(14,4),
  credit_updated_by             TEXT,
  credit_updated_at             TIMESTAMPTZ,
  -- Inline "factory confirmation requested" tracking for Price Error rows:
  factory_confirm_requested_by  TEXT,
  factory_confirm_requested_at  TIMESTAMPTZ,
  factory_confirm_confirmed_by  TEXT,
  factory_confirm_confirmed_at  TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_invoice_items_invoice_id ON shipcore.fc_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_fc_invoice_items_sku        ON shipcore.fc_invoice_items (sku);
CREATE INDEX IF NOT EXISTS idx_fc_invoice_items_result     ON shipcore.fc_invoice_items (invoice_id, result);

-- Audit log, mirroring shipcore.fc_container_audit_log (see src/lib/container-audit.ts).
CREATE TABLE IF NOT EXISTS shipcore.fc_invoice_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  invoice_id     BIGINT NOT NULL,
  invoice_number TEXT,
  user_id        TEXT,
  user_name      TEXT,
  user_email     TEXT,
  action         TEXT NOT NULL,
  before         JSONB,
  after          JSONB,
  note           TEXT,
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_invoice_audit_log_invoice_id ON shipcore.fc_invoice_audit_log (invoice_id);
CREATE INDEX IF NOT EXISTS idx_fc_invoice_audit_log_created_at ON shipcore.fc_invoice_audit_log (created_at DESC);

-- Reuse existing shipcore.set_updated_at() trigger fn (defined in 20260519123000_add_fc_factories).
DROP TRIGGER IF EXISTS trg_fc_invoices_updated_at ON shipcore.fc_invoices;
CREATE TRIGGER trg_fc_invoices_updated_at
BEFORE UPDATE ON shipcore.fc_invoices
FOR EACH ROW EXECUTE FUNCTION shipcore.set_updated_at();

DROP TRIGGER IF EXISTS trg_fc_invoice_items_updated_at ON shipcore.fc_invoice_items;
CREATE TRIGGER trg_fc_invoice_items_updated_at
BEFORE UPDATE ON shipcore.fc_invoice_items
FOR EACH ROW EXECUTE FUNCTION shipcore.set_updated_at();
