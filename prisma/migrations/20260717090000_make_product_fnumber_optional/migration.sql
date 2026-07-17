-- Product.fNumber is now set by the user once every Project (row) under the
-- product is fully Scanned, instead of being required at creation.
ALTER TABLE shipcore.pd_product_list ALTER COLUMN f_number DROP NOT NULL;
