-- Sync "Part" sales_status from fc_replacement_parts into fc_products.
-- Only updates rows where sales_status is NULL to avoid overwriting manual edits.
UPDATE shipcore.fc_products p
SET sales_status = 'Part'
WHERE p.sales_status IS NULL
  AND EXISTS (
    SELECT 1 FROM shipcore.fc_replacement_parts r
    WHERE r."partSkuValue" = p.master_sku
      AND r."shippingStatus" = 'Not Ready'
      AND r."deleteYN" = 'N'
      AND r."orderRequest" ~ '^[0-9]+$'
      AND r."orderRequest"::int > 0
  );
