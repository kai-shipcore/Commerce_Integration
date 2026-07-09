-- Credit 관리 (internal credit note ledger). Formalizes the "next phase" flagged
-- in 20260707120000_add_fc_invoices (fc_invoice_items.credit_* inline tracking).
-- Follows the fc_invoices precedent (20260707120000): raw-SQL managed table,
-- no Prisma Client model, accessed only via pg Pool.

DO $$ BEGIN
  CREATE TYPE shipcore.fc_credit_note_status AS ENUM ('pending', 'confirmed', 'applied');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS shipcore.fc_credit_notes (
  id                      BIGSERIAL PRIMARY KEY,
  factory_id              BIGINT NOT NULL REFERENCES shipcore.fc_factories(id),
  container_id            BIGINT REFERENCES shipcore.fc_containers(id) ON DELETE SET NULL,
  container_number        TEXT,
  source_invoice_id       BIGINT NOT NULL REFERENCES shipcore.fc_invoices(id) ON DELETE CASCADE,
  source_invoice_item_id  BIGINT REFERENCES shipcore.fc_invoice_items(id) ON DELETE SET NULL,
  sku                     TEXT NOT NULL,
  expected_unit_price     NUMERIC(14,4),
  invoice_unit_price      NUMERIC(14,4) NOT NULL,
  qty                     INTEGER NOT NULL CHECK (qty > 0),
  credit_amount           NUMERIC(14,4) NOT NULL,
  status                  shipcore.fc_credit_note_status NOT NULL DEFAULT 'pending',
  applied_invoice_id      BIGINT REFERENCES shipcore.fc_invoices(id) ON DELETE SET NULL,
  applied_date            DATE,
  note                    TEXT,
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at            TIMESTAMPTZ,
  applied_at              TIMESTAMPTZ,
  created_by              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One credit note per originating line: prevents the bulk-export flow from
-- creating duplicate pending credits for the same invoice item.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_credit_notes_source_item_uk
  ON shipcore.fc_credit_notes (source_invoice_item_id)
  WHERE source_invoice_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fc_credit_notes_factory_id  ON shipcore.fc_credit_notes (factory_id);
CREATE INDEX IF NOT EXISTS idx_fc_credit_notes_status      ON shipcore.fc_credit_notes (status);
CREATE INDEX IF NOT EXISTS idx_fc_credit_notes_source_inv  ON shipcore.fc_credit_notes (source_invoice_id);
CREATE INDEX IF NOT EXISTS idx_fc_credit_notes_applied_inv ON shipcore.fc_credit_notes (applied_invoice_id);

-- Reuse existing shipcore.set_updated_at() trigger fn (defined in 20260519123000_add_fc_factories).
DROP TRIGGER IF EXISTS trg_fc_credit_notes_updated_at ON shipcore.fc_credit_notes;
CREATE TRIGGER trg_fc_credit_notes_updated_at
BEFORE UPDATE ON shipcore.fc_credit_notes
FOR EACH ROW EXECUTE FUNCTION shipcore.set_updated_at();
