-- Introduce Custom vs Universal Part SKU modes. Universal SKUs have no
-- vehicle-specific segments (sku = the Part's name directly), so make/
-- makeAbbr/model/modelAbbr/code/initial/side become optional. Existing rows
-- are all pre-existing Custom SKUs, so the default backfills them correctly.
ALTER TABLE shipcore.pd_part_skus ADD COLUMN sku_type TEXT NOT NULL DEFAULT 'Custom';
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN make DROP NOT NULL;
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN make_abbr DROP NOT NULL;
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN model DROP NOT NULL;
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN model_abbr DROP NOT NULL;
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN code DROP NOT NULL;
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN initial DROP NOT NULL;
ALTER TABLE shipcore.pd_part_skus ALTER COLUMN side DROP NOT NULL;
CREATE INDEX pd_part_skus_sku_type_idx ON shipcore.pd_part_skus (sku_type);
