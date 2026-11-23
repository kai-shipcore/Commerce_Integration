/**
 * Which rows of the warehouse stock feed are current.
 *
 * `ecommerce_data.coverland_inventory_by_warehouse` (Supabase lookup DB) is
 * rewritten from ShipHero every day, and `created_at` is the time a row was
 * last written, not when the product was created. The refresh writes the rows
 * ShipHero returns and never deletes the rest, so a product removed from
 * ShipHero keeps its last row for good, with the stock it had that day.
 *
 * Found 2026-11-23 from the planning team's question about SKUs on the
 * Inventory Management page that ShipHero no longer has: `CA-FM-TX-80-FM14242`
 * (16 at Fullerton) and `CA-FM-TX-80-FM14360` (25) were rows last written
 * 2026-08-13. That day the table held 58,078 rows written the same day and 87
 * older ones, seven of them with stock (627 units), four on Active SKUs that
 * Demand Planning was counting.
 *
 * A row is a leftover when it is more than `STALE_AFTER_DAYS` older than the
 * newest row in the table. Measured from the newest row, not from now: if the
 * refresh stops, every row ages together and none is dropped. The margin is
 * days, not hours, so a refresh that fails halfway for a few days running does
 * not blank the stock of the SKUs it did not reach.
 */

export const WAREHOUSE_FEED_TABLE = "ecommerce_data.coverland_inventory_by_warehouse";

export const STALE_AFTER_DAYS = 7;

/** A SQL condition that is true for the feed rows still being refreshed. */
export function currentWarehouseFeedRowSql(createdAtExpression = "created_at"): string {
  return `(${createdAtExpression} IS NULL OR ${createdAtExpression} >= (
          SELECT MAX(created_at) FROM ${WAREHOUSE_FEED_TABLE}
        ) - INTERVAL '${STALE_AFTER_DAYS} days')`;
}
