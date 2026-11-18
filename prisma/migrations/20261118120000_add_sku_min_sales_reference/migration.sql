-- A registered SKU can now take its minimum sales from another SKU: each sales
-- figure on the Demand Planning dashboard becomes the higher of its own and
-- reference_pct % of the same figure on reference_sku. The reference SKU's
-- figures are not reduced.
-- (Planning team, 2026-11-18: Seat Cover IB is planned on 30% of the matching BE.)
--
-- A registration holds a fixed T.Avg floor, a reference, or both, so the floor
-- becomes optional. Deleting the reference SKU's product removes the
-- registration with it, like deleting the SKU's own product does.
ALTER TABLE shipcore.fc_sku_min_sales
  ALTER COLUMN min_total_avg_curr DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS reference_sku VARCHAR(128)
    REFERENCES shipcore.fc_products(master_sku) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reference_pct NUMERIC(7,2);

ALTER TABLE shipcore.fc_sku_min_sales
  ADD CONSTRAINT fc_sku_min_sales_reference_pair_check
    CHECK ((reference_sku IS NULL) = (reference_pct IS NULL)),
  ADD CONSTRAINT fc_sku_min_sales_reference_pct_check
    CHECK (reference_pct IS NULL OR (reference_pct > 0 AND reference_pct <= 1000)),
  ADD CONSTRAINT fc_sku_min_sales_reference_self_check
    CHECK (reference_sku IS NULL OR reference_sku <> master_sku),
  ADD CONSTRAINT fc_sku_min_sales_has_rule_check
    CHECK (min_total_avg_curr IS NOT NULL OR reference_sku IS NOT NULL);

-- Colour rules: every SKU of a category in `color` references the same SKU in
-- `reference_color`. This is how a new colour is usually planned, so it is one
-- row per colour instead of one registration per SKU. material is the fabric
-- (Car Cover) or material (Seat Cover) segment the rule is limited to, '' for
-- every one. A per-SKU reference above wins over a colour rule.
CREATE TABLE IF NOT EXISTS shipcore.fc_sales_reference_color_rules (
  id               SERIAL        PRIMARY KEY,
  category_code    VARCHAR(8)    NOT NULL CHECK (category_code IN ('CC', 'SC')),
  material         VARCHAR(16)   NOT NULL DEFAULT '',
  color            VARCHAR(16)   NOT NULL,
  reference_color  VARCHAR(16)   NOT NULL,
  reference_pct    NUMERIC(7,2)  NOT NULL CHECK (reference_pct > 0 AND reference_pct <= 1000),
  note             TEXT,
  created_by       VARCHAR(255),
  updated_by       VARCHAR(255),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT fc_sales_reference_color_rules_key UNIQUE (category_code, material, color),
  CONSTRAINT fc_sales_reference_color_rules_color_check CHECK (color <> reference_color)
);

-- The Car Cover Fabric 03 BK -> GR 30% rule was hardcoded in the dashboard
-- (car-cover-reference-sales.ts). It is the first colour rule, so the numbers
-- on the grid do not move when this ships.
INSERT INTO shipcore.fc_sales_reference_color_rules (category_code, material, color, reference_color, reference_pct, note, created_by, updated_by)
VALUES ('CC', '03', 'BK', 'GR', 30, 'Planning team rule, 2026-11-18', 'migration', 'migration')
ON CONFLICT (category_code, material, color) DO NOTHING;
