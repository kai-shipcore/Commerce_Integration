-- Introduce Product as the new vehicle-level container above Project.
-- Project is repurposed to be one seat row (Front/Rear/Third Row) of a
-- Product, gaining a free-text `submodel` field. ProjectPart drops the
-- now-redundant `seat_row` (owned by Project) and `configuration` columns.
--
-- All three affected tables (pd_project_list, pd_project,
-- pd_project_list_checklist_items) have 0 rows in production at the time of
-- this migration, so this is pure DDL with no data migration/backfill needed.

CREATE TABLE shipcore.pd_product_list (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  f_number TEXT NOT NULL,
  year_generation TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX pd_product_list_make_model_idx ON shipcore.pd_product_list (make, model);
CREATE INDEX pd_product_list_f_number_idx ON shipcore.pd_product_list (f_number);
CREATE INDEX pd_product_list_is_active_idx ON shipcore.pd_product_list (is_active);

ALTER TABLE shipcore.pd_project_list DROP COLUMN make;
ALTER TABLE shipcore.pd_project_list DROP COLUMN model;
ALTER TABLE shipcore.pd_project_list DROP COLUMN f_number;
ALTER TABLE shipcore.pd_project_list DROP COLUMN year_generation;
ALTER TABLE shipcore.pd_project_list DROP COLUMN researched_by_user_id;
ALTER TABLE shipcore.pd_project_list DROP COLUMN reviewed_by_user_id;
ALTER TABLE shipcore.pd_project_list ADD COLUMN product_id BIGINT NOT NULL REFERENCES shipcore.pd_product_list(id) ON DELETE CASCADE;
ALTER TABLE shipcore.pd_project_list ADD COLUMN seat_row TEXT NOT NULL;
ALTER TABLE shipcore.pd_project_list ADD COLUMN submodel TEXT;
CREATE INDEX pd_project_list_product_id_idx ON shipcore.pd_project_list (product_id);
CREATE INDEX pd_project_list_seat_row_idx ON shipcore.pd_project_list (seat_row);

ALTER TABLE shipcore.pd_project DROP COLUMN seat_row;
ALTER TABLE shipcore.pd_project DROP COLUMN configuration;
