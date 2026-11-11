-- SKUs that will be replaced soon (Replacing Soon page). The automatic order
-- calculations on the Demand Planning dashboard order a registered SKU only up
-- to target_inv_life_days of inventory life, instead of the sales-range or
-- gradient target, so a SKU about to change is not stocked for months.
-- replacement_sku is informational (shown on the dashboard) and is not a
-- foreign key: the successor may not exist in SKU Master yet. Deleting the row
-- unregisters the SKU and restores the normal targets.
CREATE TABLE IF NOT EXISTS shipcore.fc_sku_replacing_soon (
  master_sku           VARCHAR(128) PRIMARY KEY
                         REFERENCES shipcore.fc_products(master_sku)
                         ON UPDATE CASCADE ON DELETE CASCADE,
  target_inv_life_days INTEGER      NOT NULL DEFAULT 30
                         CHECK (target_inv_life_days BETWEEN 1 AND 365),
  replacement_sku      VARCHAR(128),
  note                 TEXT,
  created_by           VARCHAR(255),
  updated_by           VARCHAR(255),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
