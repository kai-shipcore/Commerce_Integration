-- Seat cover parts were sitting in Accessories.
--
-- BACK-SEAT-COVER-PARTS, FRONT-SEAT-COVER-PARTS and INDV-SEAT-COVER-PART are
-- the aggregate part rows for seat covers, but they lack the CA-SC- prefix
-- inferProduct keys on, so they were written as AC. That was invisible until
-- the planning dashboard's category picker put Accessories in the Car Cover
-- group, where a row badged "Part" has no business being.
--
-- inferProduct now reads the name, which covers rows created from here on;
-- this fixes the three that already exist. The sync's upsert keeps an existing
-- category (COALESCE on conflict), so it will not undo this.
UPDATE shipcore.fc_products
SET category      = 'Seat Cover',
    category_code = 'SC',
    updated_at    = NOW()
WHERE UPPER(master_sku) LIKE '%SEAT-COVER-PART%'
  AND category_code IS DISTINCT FROM 'SC';
