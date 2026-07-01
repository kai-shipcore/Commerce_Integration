-- Remove qty and passenger-side D/P detail columns that are no longer used in the UI.
-- D/P is now a single shared field per paired group; qty is always 1 or 2 (derived).
-- Middle and Console sections are single-part (no D/P or qty needed).

DO $$ BEGIN

  -- front table
  ALTER TABLE shipcore.fc_seat_cover_parts_front
    DROP COLUMN IF EXISTS headrest2_dp_detail,
    DROP COLUMN IF EXISTS headrest_qty,
    DROP COLUMN IF EXISTS headrest2_qty,
    DROP COLUMN IF EXISTS top_body2_dp_detail,
    DROP COLUMN IF EXISTS top_body_qty,
    DROP COLUMN IF EXISTS top_body2_qty,
    DROP COLUMN IF EXISTS bottom2_dp_detail,
    DROP COLUMN IF EXISTS bottom_qty,
    DROP COLUMN IF EXISTS bottom2_qty,
    DROP COLUMN IF EXISTS armrest2_detail,
    DROP COLUMN IF EXISTS armrest_qty,
    DROP COLUMN IF EXISTS armrest2_qty,
    DROP COLUMN IF EXISTS middle_headrest_detail,
    DROP COLUMN IF EXISTS middle_headrest_qty,
    DROP COLUMN IF EXISTS middle_top_body_detail,
    DROP COLUMN IF EXISTS middle_top_body_qty,
    DROP COLUMN IF EXISTS middle_bottom_detail,
    DROP COLUMN IF EXISTS middle_bottom_qty;

  -- rear table
  ALTER TABLE shipcore.fc_seat_cover_parts_rear
    DROP COLUMN IF EXISTS headrest2_dp_detail,
    DROP COLUMN IF EXISTS headrest_qty,
    DROP COLUMN IF EXISTS headrest2_qty,
    DROP COLUMN IF EXISTS top_body2_dp_detail,
    DROP COLUMN IF EXISTS top_body_qty,
    DROP COLUMN IF EXISTS top_body2_qty,
    DROP COLUMN IF EXISTS bottom2_dp_detail,
    DROP COLUMN IF EXISTS bottom_qty,
    DROP COLUMN IF EXISTS bottom2_qty,
    DROP COLUMN IF EXISTS armrest2_detail,
    DROP COLUMN IF EXISTS armrest_qty,
    DROP COLUMN IF EXISTS armrest2_qty,
    DROP COLUMN IF EXISTS middle_headrest_detail,
    DROP COLUMN IF EXISTS middle_headrest_qty,
    DROP COLUMN IF EXISTS middle_top_body_detail,
    DROP COLUMN IF EXISTS middle_top_body_qty,
    DROP COLUMN IF EXISTS middle_bottom_detail,
    DROP COLUMN IF EXISTS middle_bottom_qty,
    DROP COLUMN IF EXISTS console_dp_detail,
    DROP COLUMN IF EXISTS console_qty,
    DROP COLUMN IF EXISTS backrest_storage2_dp_detail,
    DROP COLUMN IF EXISTS backrest_storage_qty,
    DROP COLUMN IF EXISTS backrest_storage2_qty,
    DROP COLUMN IF EXISTS subpart2_dp_detail,
    DROP COLUMN IF EXISTS subpart_qty,
    DROP COLUMN IF EXISTS subpart2_qty;

  -- third table
  ALTER TABLE shipcore.fc_seat_cover_parts_third
    DROP COLUMN IF EXISTS headrest2_dp_detail,
    DROP COLUMN IF EXISTS headrest_qty,
    DROP COLUMN IF EXISTS headrest2_qty,
    DROP COLUMN IF EXISTS top_body2_dp_detail,
    DROP COLUMN IF EXISTS top_body_qty,
    DROP COLUMN IF EXISTS top_body2_qty,
    DROP COLUMN IF EXISTS bottom2_dp_detail,
    DROP COLUMN IF EXISTS bottom_qty,
    DROP COLUMN IF EXISTS bottom2_qty,
    DROP COLUMN IF EXISTS armrest2_detail,
    DROP COLUMN IF EXISTS armrest_qty,
    DROP COLUMN IF EXISTS armrest2_qty,
    DROP COLUMN IF EXISTS middle_headrest_detail,
    DROP COLUMN IF EXISTS middle_headrest_qty,
    DROP COLUMN IF EXISTS middle_top_body_detail,
    DROP COLUMN IF EXISTS middle_top_body_qty,
    DROP COLUMN IF EXISTS middle_bottom_detail,
    DROP COLUMN IF EXISTS middle_bottom_qty,
    DROP COLUMN IF EXISTS console_dp_detail,
    DROP COLUMN IF EXISTS console_qty,
    DROP COLUMN IF EXISTS backrest_storage2_dp_detail,
    DROP COLUMN IF EXISTS backrest_storage_qty,
    DROP COLUMN IF EXISTS backrest_storage2_qty,
    DROP COLUMN IF EXISTS subpart2_dp_detail,
    DROP COLUMN IF EXISTS subpart_qty,
    DROP COLUMN IF EXISTS subpart2_qty;

END $$;
