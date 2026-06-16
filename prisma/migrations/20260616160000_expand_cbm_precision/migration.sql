-- Allow CBM per-unit values such as 0.048852 to be stored consistently.
DROP VIEW IF EXISTS shipcore.fc_forecast_dashboard;

ALTER TABLE shipcore.fc_products
  ALTER COLUMN cbm_per_unit TYPE NUMERIC(14, 6)
  USING cbm_per_unit::NUMERIC(14, 6);

ALTER TABLE shipcore.fc_container_items
  ALTER COLUMN cbm_unit TYPE NUMERIC(14, 6)
  USING cbm_unit::NUMERIC(14, 6);

ALTER TABLE shipcore.fc_container_items
  ALTER COLUMN total_cbm TYPE NUMERIC(14, 6)
  USING total_cbm::NUMERIC(14, 6);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'shipcore'
      AND table_name = 'fc_available_stock'
      AND column_name = 'cbm_unit'
  ) THEN
    ALTER TABLE shipcore.fc_available_stock
      ALTER COLUMN cbm_unit TYPE NUMERIC(14, 6)
      USING cbm_unit::NUMERIC(14, 6);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'shipcore'
      AND table_name = 'fc_purchase_order_items'
      AND column_name = 'cbm_unit'
  ) THEN
    ALTER TABLE shipcore.fc_purchase_order_items
      ALTER COLUMN cbm_unit TYPE NUMERIC(14, 6)
      USING cbm_unit::NUMERIC(14, 6);
  END IF;
END $$;

CREATE VIEW shipcore.fc_forecast_dashboard AS
SELECT p.master_sku,
    p.sub_category_code,
    p.status AS product_status,
    p.moq,
    p.cbm_per_unit,
    COALESCE(st.total_usable_qty, 0::numeric) AS stock_qty,
    COALESCE(st.total_backorder, 0::numeric) AS backorder_qty,
    COALESCE(ib.inbound_qty, 0::bigint) AS inbound_qty,
    ib.nearest_eta,
    fb.adjusted_daily_forecast AS daily_forecast,
    fb.seasonality_factor,
    CASE
      WHEN fb.adjusted_daily_forecast > 0::numeric THEN round(COALESCE(st.total_usable_qty, 0::numeric) / fb.adjusted_daily_forecast)
      ELSE NULL::numeric
    END AS days_of_cover,
    CURRENT_DATE +
    CASE
      WHEN fb.adjusted_daily_forecast > 0::numeric THEN round(COALESCE(st.total_usable_qty, 0::numeric) / fb.adjusted_daily_forecast)::integer
      ELSE 9999
    END AS est_sold_out_date
  FROM shipcore.fc_products p
    LEFT JOIN shipcore.fc_stock_total st ON st.master_sku::text = p.master_sku::text
    LEFT JOIN shipcore.fc_inbound_qty ib ON ib.master_sku::text = p.master_sku::text
    LEFT JOIN LATERAL (
      SELECT fc_forecast_baselines.adjusted_daily_forecast,
        fc_forecast_baselines.seasonality_factor
      FROM shipcore.fc_forecast_baselines
      WHERE fc_forecast_baselines.master_sku::text = p.master_sku::text
      ORDER BY fc_forecast_baselines.forecast_date DESC
      LIMIT 1
    ) fb ON true
  WHERE p.status = 'active'::shipcore.fc_product_status;
