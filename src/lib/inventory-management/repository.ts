/**
 * Data access for the Inventory Management page: warehouse stock per master
 * SKU, exactly as the warehouse feed names it.
 *
 * Read from the Supabase lookup DB (`ecommerce_data.coverland_inventory_by_warehouse`),
 * the same feed the Demand Planning Sync reads. The SKU is deliberately NOT
 * remapped here: the page has to show which SKU the stock really sits under,
 * so the remaps are applied in the service, where the source SKU is still known.
 *
 * Every row is returned, including the ones ShipHero's daily update no longer
 * writes: that stock can still be on the shelf (a product made inactive in
 * ShipHero). Those rows come back with `stale` set and the date they were last
 * written, so the page can mark them (`planning/warehouse-feed.ts`).
 */

import { getLookupPool } from "@/lib/db/supabase-lookup";
import { staleWarehouseFeedRowSql } from "@/lib/planning/warehouse-feed";

export interface WarehouseStockRow {
  master_sku: string;
  warehouse: string;
  on_hand: number;
  available: number;
  /** ShipHero's daily update no longer writes this row. */
  stale?: boolean;
  /** The day the row was last written, `YYYY-MM-DD`. */
  last_updated?: string | null;
}

export const InventoryManagementRepository = {
  /** One row per (SKU, warehouse). Null when the lookup DB is not configured. */
  async getStockBySkuAndWarehouse(): Promise<WarehouseStockRow[] | null> {
    const lookup = getLookupPool();
    if (!lookup) return null;
    const result = await lookup.query<WarehouseStockRow>(`
      SELECT
        BTRIM(master_sku)                    AS master_sku,
        COALESCE(NULLIF(BTRIM(warehouse), ''), 'Unspecified') AS warehouse,
        SUM(COALESCE(on_hand, 0))::int       AS on_hand,
        SUM(COALESCE(available, 0))::int     AS available,
        BOOL_AND(${staleWarehouseFeedRowSql()}) AS stale,
        TO_CHAR(MAX(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_updated
      FROM ecommerce_data.coverland_inventory_by_warehouse
      WHERE master_sku IS NOT NULL AND BTRIM(master_sku) <> ''
      GROUP BY 1, 2
    `);
    return result.rows;
  },
};
