-- Create factory master table for factory autocomplete/selection in FC planning.
-- Also adds an optional FK from fc_purchase_orders to fc_factories while keeping factory_name for compatibility.

CREATE TABLE IF NOT EXISTS shipcore.fc_factories (
  id BIGSERIAL PRIMARY KEY,
  factory_code VARCHAR(50) UNIQUE,
  factory_name VARCHAR(200) NOT NULL UNIQUE,
  origin VARCHAR(200),
  contact_name VARCHAR(100),
  email VARCHAR(200),
  phone VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fc_factories_active ON shipcore.fc_factories (is_active);
CREATE INDEX IF NOT EXISTS idx_fc_factories_name ON shipcore.fc_factories (factory_name);

CREATE OR REPLACE FUNCTION shipcore.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fc_factories_updated_at ON shipcore.fc_factories;
CREATE TRIGGER trg_fc_factories_updated_at
BEFORE UPDATE ON shipcore.fc_factories
FOR EACH ROW EXECUTE FUNCTION shipcore.set_updated_at();

ALTER TABLE shipcore.fc_purchase_orders
  ADD COLUMN IF NOT EXISTS factory_id BIGINT;

ALTER TABLE shipcore.fc_purchase_orders
  DROP CONSTRAINT IF EXISTS fc_purchase_orders_factory_id_fkey;

ALTER TABLE shipcore.fc_purchase_orders
  ADD CONSTRAINT fc_purchase_orders_factory_id_fkey
  FOREIGN KEY (factory_id) REFERENCES shipcore.fc_factories(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fc_purchase_orders_factory_id ON shipcore.fc_purchase_orders (factory_id);

INSERT INTO shipcore.fc_factories (factory_name, origin)
SELECT DISTINCT TRIM(factory_name), MAX(origin)
FROM shipcore.fc_purchase_orders
WHERE factory_name IS NOT NULL AND TRIM(factory_name) <> ''
GROUP BY TRIM(factory_name)
ON CONFLICT (factory_name) DO NOTHING;

UPDATE shipcore.fc_purchase_orders po
SET factory_id = f.id
FROM shipcore.fc_factories f
WHERE po.factory_id IS NULL
  AND po.factory_name IS NOT NULL
  AND TRIM(po.factory_name) = f.factory_name;
