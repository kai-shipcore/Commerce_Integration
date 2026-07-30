import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

const SORT_COLUMN_MAP: Record<string, string> = {
  masterSkuCode: "p.master_sku",
  name: "p.product_name",
  available: "inv_available",
  onHand: "inv_on_hand",
  backorder: "inv_backorder",
  salesRecords: "p.master_sku",
  webSkuCount: "web_sku_count",
};

export type ProductListRow = {
  master_sku: string;
  product_name: string;
  category: string | null;
  web_sku_count: bigint;
  inv_on_hand: string | null;
  inv_available: string | null;
  inv_backorder: string | null;
  inv_reserved: string | null;
};

export type ProductDetailRow = {
  master_sku: string;
  product_name: string;
  category: string | null;
  status: string | null;
};

export type InventoryByWarehouseRow = {
  warehouse_code: string;
  on_hand_qty: string;
  available_qty: string;
  backorder_qty: string;
  reserved_qty: string;
};

export type ChannelMappingRow = {
  channel_sku: string;
  channel: string;
  product_name: string | null;
};

export interface ListProductsParams {
  search: string | null;
  category: string | null;
  sortBy: string;
  sortOrder: "ASC" | "DESC";
  limit: number;
  offset: number;
}

/**
 * Pure data access for the SKU domain. Wraps the sc_products/
 * sc_inventory_snapshot/sc_sku_mappings/sc_sales_order_items tables (now
 * modeled in schema.prisma but still queried via raw SQL for the aggregated
 * list/detail views, since the dynamic ORDER BY + cross-table aggregation
 * isn't expressible through Prisma's query builder).
 *
 * Read-only: the create/update/delete SKU-management methods were removed
 * along with the standalone /skus page, which was unreachable (hidden from
 * navigation, no callers).
 */
export const SkuRepository = {
  resolveSortColumn(sortBy: string): string {
    return SORT_COLUMN_MAP[sortBy] ?? SORT_COLUMN_MAP.masterSkuCode;
  },

  async getCategories(): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ category: string }[]>`
      SELECT DISTINCT p.category FROM shipcore.sc_products p
      WHERE p.category IS NOT NULL ORDER BY p.category`;
    return rows.map((r) => r.category);
  },

  async countProducts(search: string | null, category: string | null): Promise<number> {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM shipcore.sc_products p
      WHERE (
          ${search}::text IS NULL
          OR p.master_sku ILIKE ${search}
          OR p.product_name ILIKE ${search}
          OR EXISTS (
            SELECT 1
            FROM shipcore.sc_sku_mappings sm_search
            WHERE sm_search.master_sku = p.master_sku
              AND sm_search.channel_sku ILIKE ${search}
          )
        )
        AND (${category}::text IS NULL OR p.category = ${category})`;
    return Number(rows[0]?.count ?? 0);
  },

  async listProducts({ search, category, sortBy, sortOrder, limit, offset }: ListProductsParams): Promise<ProductListRow[]> {
    const sortColumn = this.resolveSortColumn(sortBy);
    return prisma.$queryRaw<ProductListRow[]>`
      SELECT
         p.master_sku,
         p.product_name,
         p.category,
         COUNT(DISTINCT sm.channel_sku)::bigint AS web_sku_count,
         COALESCE(SUM(i.on_hand_qty), 0)::text  AS inv_on_hand,
         COALESCE(SUM(i.available_qty), 0)::text AS inv_available,
         COALESCE(SUM(i.backorder_qty), 0)::text AS inv_backorder,
         COALESCE(SUM(i.reserved_qty), 0)::text  AS inv_reserved
       FROM shipcore.sc_products p
       LEFT JOIN shipcore.sc_inventory_snapshot i ON i.master_sku = p.master_sku
       LEFT JOIN shipcore.sc_sku_mappings sm ON sm.master_sku = p.master_sku
       WHERE (
           ${search}::text IS NULL
           OR p.master_sku ILIKE ${search}
           OR p.product_name ILIKE ${search}
           OR EXISTS (
             SELECT 1
             FROM shipcore.sc_sku_mappings sm_search
             WHERE sm_search.master_sku = p.master_sku
               AND sm_search.channel_sku ILIKE ${search}
           )
         )
         AND (${category}::text IS NULL OR p.category = ${category})
       GROUP BY p.master_sku, p.product_name, p.category
       ORDER BY ${Prisma.raw(sortColumn)} ${Prisma.raw(sortOrder)}
       LIMIT ${limit} OFFSET ${offset}`;
  },

  async getSalesQuantityByMasterSku(masterSkus: string[], since: Date): Promise<Map<string, number>> {
    if (masterSkus.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ master_sku: string; qty: string }[]>`
      SELECT i.master_sku, COALESCE(SUM(i.quantity), 0)::text AS qty
      FROM shipcore.sc_sales_order_items i
      JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
      WHERE i.master_sku = ANY(${masterSkus}::text[])
        AND o.order_date >= ${since}
        AND i.is_counted_in_demand = true
      GROUP BY i.master_sku`;
    return new Map(rows.map((r) => [r.master_sku, parseInt(r.qty, 10)]));
  },

  async getProductDetail(masterSku: string): Promise<ProductDetailRow | null> {
    const rows = await prisma.$queryRaw<ProductDetailRow[]>`
      SELECT master_sku, product_name, category, status FROM shipcore.sc_products WHERE master_sku = ${masterSku}`;
    return rows[0] ?? null;
  },

  async getInventoryByWarehouse(masterSku: string): Promise<InventoryByWarehouseRow[]> {
    return prisma.$queryRaw<InventoryByWarehouseRow[]>`
      SELECT warehouse_code, on_hand_qty::text, available_qty::text, backorder_qty::text, reserved_qty::text
      FROM shipcore.sc_inventory_snapshot
      WHERE master_sku = ${masterSku}
      ORDER BY warehouse_code`;
  },

  async getChannelMappings(masterSku: string): Promise<ChannelMappingRow[]> {
    return prisma.$queryRaw<ChannelMappingRow[]>`
      SELECT sm.channel_sku, sm.channel, p.product_name
      FROM shipcore.sc_sku_mappings sm
      LEFT JOIN shipcore.sc_products p ON p.id = sm.product_id
      WHERE sm.master_sku = ${masterSku}
      ORDER BY sm.channel_sku`;
  },

  async countSalesForProduct(masterSku: string): Promise<number> {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM shipcore.sc_sales_order_items i
      WHERE i.product_id = (SELECT id FROM shipcore.sc_products WHERE master_sku = ${masterSku})
        AND i.is_counted_in_demand = true`;
    return rows[0]?.count ?? 0;
  },
};
