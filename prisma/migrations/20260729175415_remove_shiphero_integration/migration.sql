-- Remove ShipHero integration: drop columns used for ShipHero order creation on
-- replacement parts, and drop the ShipHero credentials table.
ALTER TABLE shipcore.fc_replacement_parts
  DROP COLUMN IF EXISTS "shipheroOrder",
  DROP COLUMN IF EXISTS "shipheroOrderId";

DROP TABLE IF EXISTS shipcore.fc_shiphero_credentials;
