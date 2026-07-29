-- Remove the Seat Cover Parts (Planning) feature: drop its backing table now that
-- the page, API routes, and cross-feature integrations (home-stats SC adjustment,
-- SKU Master 'Part' filter, Demand Planning 'Part' row merge) have been removed.
DROP TABLE IF EXISTS shipcore.fc_replacement_parts;
