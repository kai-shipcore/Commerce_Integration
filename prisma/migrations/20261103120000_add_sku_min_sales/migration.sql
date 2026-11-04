-- Per-SKU floor for the Demand Planning "T.Avg 현재" (total_avg_curr) column.
-- A registered SKU whose calculated current daily average falls below
-- min_total_avg_curr is shown (and planned) at the minimum instead. A manual
-- fc_products.total_avg_curr_override still wins over both. Deleting the row
-- unregisters the SKU and restores the calculated value.
CREATE TABLE IF NOT EXISTS shipcore.fc_sku_min_sales (
  master_sku          VARCHAR(128)  PRIMARY KEY
                        REFERENCES shipcore.fc_products(master_sku)
                        ON UPDATE CASCADE ON DELETE CASCADE,
  min_total_avg_curr  NUMERIC(14,4) NOT NULL CHECK (min_total_avg_curr >= 0),
  note                TEXT,
  created_by          VARCHAR(255),
  updated_by          VARCHAR(255),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
