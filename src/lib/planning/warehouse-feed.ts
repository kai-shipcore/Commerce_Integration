/**
 * Which rows of the warehouse stock feed ShipHero is still updating.
 *
 * `ecommerce_data.coverland_inventory_by_warehouse` (Supabase lookup DB) is
 * rewritten from ShipHero every day, and `created_at` is the time a row was
 * last written, not when the product was created. The refresh writes the rows
 * ShipHero returns and never deletes the rest, so a product that drops out of
 * ShipHero's daily list keeps its last row, with the stock it had that day.
 *
 * **A row that stopped updating is not proof the stock is gone.** A product
 * made inactive in ShipHero drops out of the list while its units are still on
 * the shelf: `CA-NP-01-BK` was last written 2026-10-20 with 196 at Fullerton,
 * and ShipHero showed the same 196 on 2026-11-23. For one day (2026-11-23)
 * these rows were filtered out of Inventory Management and the Demand Planning
 * Sync as "leftovers of removed products"; the planning team pointed out the
 * stock was real, and the filter was removed. They are now kept and marked.
 *
 * What the feed cannot say:
 *  - whether the product is inactive in ShipHero or was deleted there
 *    (`CA-FM-TX-80-FM14242`, last written 2026-08-13, could not be found in
 *    ShipHero at all), and
 *  - which warehouses it is inactive at. ShipHero keeps that per warehouse, but
 *    the feed has no such column, and a product inactive at one warehouse stops
 *    updating at all of them (every `cablelock` row stopped on 2026-09-17).
 * A real per-warehouse status needs the feed itself to carry ShipHero's
 * `active` flag.
 *
 * A row counts as no longer updated when it is more than `STALE_AFTER_DAYS`
 * older than the newest row in the table. Measured from the newest row, not
 * from now: if the refresh stops, every row ages together and none is marked.
 * The margin is days, not hours, so a refresh that fails halfway for a few days
 * running does not mark the SKUs it did not reach.
 */

export const WAREHOUSE_FEED_TABLE = "ecommerce_data.coverland_inventory_by_warehouse";

export const STALE_AFTER_DAYS = 7;

/** A SQL boolean: true for a feed row ShipHero's daily update no longer writes. */
export function staleWarehouseFeedRowSql(createdAtExpression = "created_at"): string {
  return `(${createdAtExpression} IS NOT NULL AND ${createdAtExpression} < (
          SELECT MAX(created_at) FROM ${WAREHOUSE_FEED_TABLE}
        ) - INTERVAL '${STALE_AFTER_DAYS} days')`;
}
