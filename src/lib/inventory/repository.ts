import { getLookupPool } from "@/lib/db/supabase-lookup";

export type InventoryGroupBy = "warehouse" | "product";

// Single source of truth for valid sort keys — Service validates incoming
// sortBy against this array; Repository's SORT_BY_MAP below maps each key to
// its actual SQL column (the `Record<InventorySortBy, string>` annotation
// there forces it to stay in sync with this list at compile time).
export const INVENTORY_SORT_KEYS = [
  "masterSku",
  "warehouse",
  "warehouseCount",
  "onHand",
  "allocated",
  "available",
  "backorder",
  "createdAt",
] as const;

export type InventorySortBy = (typeof INVENTORY_SORT_KEYS)[number];

export interface InventoryQueryOptions {
  page?: number;
  limit?: number;
  exportAll?: boolean;
  groupBy?: InventoryGroupBy;
  search?: string;
  warehouse?: string;
  sortBy?: InventorySortBy;
  sortOrder?: "asc" | "desc";
}

/**
 * Fully-normalized query params, as resolved by InventoryService before
 * calling the repository. Repository trusts these values as-is — no
 * re-clamping or re-defaulting.
 */
export interface ResolvedInventoryQuery {
  page: number;
  limit: number;
  offset: number;
  exportAll: boolean;
  search: string;
  warehouse: string;
  groupBy: InventoryGroupBy;
  sortBy: InventorySortBy;
  sortOrder: "asc" | "desc";
}

export interface InventoryRow {
  masterSku: string;
  onHand: number;
  allocated: number;
  available: number;
  backorder: number;
  warehouse: string | null;
  warehouseCount?: number;
  createdAt: string | null;
}

export interface InventoryQueryResult {
  rows: InventoryRow[];
  totalRows: number;
  totalProducts: number;
  totalWarehouses: number;
  totals: {
    onHand: number;
    allocated: number;
    available: number;
    backorder: number;
  };
  warehouses: string[];
}

const SORT_BY_MAP: Record<InventorySortBy, string> = {
  masterSku: "master_sku",
  warehouse: "warehouse",
  warehouseCount: "warehouse_count",
  onHand: "on_hand",
  allocated: "allocated",
  available: "available",
  backorder: "backorder",
  createdAt: "created_at",
};

/**
 * Pure data access for the Coverland warehouse inventory feed, sourced from
 * the legacy Supabase lookup DB (`ecommerce_data.coverland_inventory_by_warehouse`).
 * Caching is a Service-layer concern (see inventory.service.ts) — this
 * repository has no knowledge of Redis.
 */
export const InventoryRepository = {
  async queryCoverlandInventory(resolved: ResolvedInventoryQuery): Promise<InventoryQueryResult> {
    const pool = getLookupPool();
    if (!pool) throw new Error("No lookup database connection configured");

    const { limit, offset, search, warehouse, groupBy, exportAll } = resolved;
    const sortColumn = SORT_BY_MAP[resolved.sortBy];
    const sortOrderSql = resolved.sortOrder === "desc" ? "DESC" : "ASC";

    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`btrim(master_sku) ILIKE $${params.length}`);
    }

    if (warehouse && warehouse !== "all") {
      if (warehouse === "Unspecified") {
        filters.push(`(warehouse IS NULL OR warehouse = '')`);
      } else {
        params.push(warehouse);
        filters.push(`warehouse = $${params.length}`);
      }
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const paginationParams = [...params];
    if (!exportAll) {
      paginationParams.push(limit);
      paginationParams.push(offset);
    }

    const [summaryResult, warehouseResult, result] = await Promise.all([
      pool.query<{
        total_rows: string;
        total_products: string;
        total_warehouses: string;
        total_on_hand: string | null;
        total_allocated: string | null;
        total_available: string | null;
        total_backorder: string | null;
      }>(
        `SELECT
          COUNT(*)::text AS total_rows,
          COUNT(DISTINCT btrim(master_sku)) FILTER (WHERE master_sku IS NOT NULL AND btrim(master_sku) <> '')::text AS total_products,
          COUNT(DISTINCT NULLIF(warehouse, ''))::text AS total_warehouses,
          COALESCE(SUM(on_hand), 0)::text AS total_on_hand,
          COALESCE(SUM(allocated), 0)::text AS total_allocated,
          COALESCE(SUM(available), 0)::text AS total_available,
          COALESCE(SUM(backorder), 0)::text AS total_backorder
        FROM ecommerce_data.coverland_inventory_by_warehouse
        ${whereClause}`,
        params,
      ),
      pool.query<{ warehouse: string | null }>(
        `SELECT DISTINCT warehouse
        FROM ecommerce_data.coverland_inventory_by_warehouse
        WHERE warehouse IS NOT NULL AND warehouse <> ''
        ORDER BY warehouse ASC`,
      ),
      groupBy === "product"
        ? pool.query<{
            master_sku: string;
            on_hand: number | null;
            allocated: number | null;
            available: number | null;
            backorder: number | null;
            warehouse_count: string;
            created_at: Date | string | null;
          }>(
            `SELECT
              btrim(master_sku) AS master_sku,
              COALESCE(SUM(on_hand), 0) AS on_hand,
              COALESCE(SUM(allocated), 0) AS allocated,
              COALESCE(SUM(available), 0) AS available,
              COALESCE(SUM(backorder), 0) AS backorder,
              COUNT(DISTINCT NULLIF(warehouse, ''))::text AS warehouse_count,
              MAX(created_at) AS created_at
            FROM ecommerce_data.coverland_inventory_by_warehouse
            ${whereClause}
            GROUP BY btrim(master_sku)
            ORDER BY ${sortColumn} ${sortOrderSql}, master_sku ASC
            ${exportAll ? "" : `LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`}`,
            paginationParams,
          )
        : pool.query<{
            master_sku: string;
            on_hand: number | null;
            allocated: number | null;
            available: number | null;
            backorder: number | null;
            warehouse: string | null;
            created_at: Date | string | null;
          }>(
            `SELECT
              btrim(master_sku) AS master_sku,
              on_hand,
              allocated,
              available,
              backorder,
              warehouse,
              created_at
            FROM ecommerce_data.coverland_inventory_by_warehouse
            ${whereClause}
            ORDER BY ${sortColumn} ${sortOrderSql}, master_sku ASC
            ${exportAll ? "" : `LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`}`,
            paginationParams,
          ),
    ]);

    const summary = summaryResult.rows[0];

    return {
      rows: result.rows.map((row) => ({
        masterSku: row.master_sku,
        onHand: row.on_hand ?? 0,
        allocated: row.allocated ?? 0,
        available: row.available ?? 0,
        backorder: row.backorder ?? 0,
        warehouse: "warehouse" in row ? row.warehouse : null,
        warehouseCount: "warehouse_count" in row ? Number(row.warehouse_count ?? 0) : undefined,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      })),
      totalRows: Number(summary?.total_rows ?? 0),
      totalProducts: Number(summary?.total_products ?? 0),
      totalWarehouses: Number(summary?.total_warehouses ?? 0),
      totals: {
        onHand: Number(summary?.total_on_hand ?? 0),
        allocated: Number(summary?.total_allocated ?? 0),
        available: Number(summary?.total_available ?? 0),
        backorder: Number(summary?.total_backorder ?? 0),
      },
      warehouses: warehouseResult.rows
        .map((row) => row.warehouse)
        .filter((value): value is string => Boolean(value)),
    };
  },
};
