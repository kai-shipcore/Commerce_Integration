-- Floor mat set links, maintained on the SKU Master page.
--
-- A floor mat Master Set SKU is sold as one item but stocked as loose
-- components: one Front (1st Row) SKU and one Rear (2nd Row) SKU make a set.
-- This table records which components belong to which master, so the Demand
-- Planning dashboard can pair loose component stock into sellable sets.
--
--   front_sku / rear_sku  The two components. rear_sku is NULL for a master
--                         that only has a front row; such a master takes no
--                         part in pairing.
--   third_rows            JSON array of {"sku": text, "preOrder": bool|null},
--                         in display order. Reference only: the 3rd Row is not
--                         part of pairing. A master can list several, and each
--                         carries its own "3열 Pre-Order 가능?" value, which may
--                         differ from that 3rd Row SKU's own preorder_3.
--   preorder_12           "1~2열 Pre-Order 가능?" for this SKU.
--   preorder_3            "3열 Pre-Order 가능?" for a SKU with no third_rows of
--                         its own, i.e. a standalone 3rd Row SKU.
--   old_set_skus          Old Master Set SKUs this master replaced. Reference
--                         only; nothing is rolled up from them.
--
-- Component SKUs are not foreign keys: a new component can be linked before it
-- shows up in inventory and gets its fc_products row. A row with every value
-- empty is deleted by the service rather than kept.
CREATE TABLE IF NOT EXISTS shipcore.fc_floor_mat_sets (
  master_sku   VARCHAR(128) PRIMARY KEY
                 REFERENCES shipcore.fc_products(master_sku)
                 ON UPDATE CASCADE ON DELETE CASCADE,
  front_sku    VARCHAR(128),
  rear_sku     VARCHAR(128),
  preorder_12  BOOLEAN,
  preorder_3   BOOLEAN,
  third_rows   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  old_set_skus TEXT[]       NOT NULL DEFAULT '{}',
  created_by   VARCHAR(255),
  updated_by   VARCHAR(255),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Pairing looks masters up by component ("which masters share this front?").
CREATE INDEX IF NOT EXISTS fc_floor_mat_sets_front_sku_idx ON shipcore.fc_floor_mat_sets (front_sku);
CREATE INDEX IF NOT EXISTS fc_floor_mat_sets_rear_sku_idx  ON shipcore.fc_floor_mat_sets (rear_sku);
