-- Create purchase order status enum
DO $$ BEGIN
  CREATE TYPE shipcore.fc_po_status AS ENUM ('draft', 'pending', 'approved', 'sent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create fc_purchase_orders table
CREATE TABLE IF NOT EXISTS shipcore.fc_purchase_orders (
  id             BIGSERIAL PRIMARY KEY,
  po_number      TEXT NOT NULL,
  po_date        DATE,
  eta_date       DATE,
  factory_id     BIGINT,
  factory_name   TEXT,
  origin         TEXT,
  dest_warehouse TEXT,
  manager        TEXT,
  note           TEXT,
  status         shipcore.fc_po_status NOT NULL DEFAULT 'draft',
  created_by     TEXT,
  sent_at        TIMESTAMP(3),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create fc_purchase_order_items table
CREATE TABLE IF NOT EXISTS shipcore.fc_purchase_order_items (
  id         BIGSERIAL PRIMARY KEY,
  po_id      BIGINT NOT NULL,
  master_sku TEXT NOT NULL,
  moq        INTEGER NOT NULL DEFAULT 1,
  order_qty  INTEGER NOT NULL,
  cbm_unit   NUMERIC(14,6),
  total_cbm  NUMERIC(14,6),
  unit_price NUMERIC(14,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fc_purchase_order_items_po_id_fkey
    FOREIGN KEY (po_id) REFERENCES shipcore.fc_purchase_orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fc_purchase_orders_status   ON shipcore.fc_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_fc_purchase_orders_po_date  ON shipcore.fc_purchase_orders(po_date DESC);
CREATE INDEX IF NOT EXISTS idx_fc_purchase_order_items_po  ON shipcore.fc_purchase_order_items(po_id);
