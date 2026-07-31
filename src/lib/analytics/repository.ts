/**
 * Data access for the home/analytics dashboard: legacy Prisma SKU-catalog
 * counts (totalSKUs, totalCollections, low-stock list) plus raw-SQL sales
 * aggregation against shipcore.sc_sales_orders/sc_sales_order_items.
 */

import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";

export interface SalesAgg {
  qty: string;
  revenue: string;
  cnt: string;
}

export interface TopSkuRow {
  master_sku: string;
  qty: string;
  revenue: string;
  cnt: string;
}

export interface DayRow {
  day: string;
  qty: string;
  revenue: string;
}

export interface RecentRow {
  master_sku: string;
  channel_sku: string;
  platform_source: string;
  order_date: string;
  quantity: string;
}

export const AnalyticsRepository = {
  countSkus() {
    return prisma.sKU.count();
  },

  countCollections() {
    return prisma.sKUCollection.count();
  },

  findLowStockSkus() {
    return prisma.sKU.findMany({
      where: {
        AND: [
          { reorderPoint: { not: null } },
          { currentStock: { lte: prisma.sKU.fields.reorderPoint } },
        ],
      },
      select: { id: true, skuCode: true, name: true, currentStock: true, reorderPoint: true },
      take: 10,
    });
  },

  async getSalesAgg(since: Date): Promise<SalesAgg> {
    const result = await getPrimaryPool().query<SalesAgg>(
      `SELECT COALESCE(SUM(i.quantity),0)::text AS qty,
              COALESCE(SUM(i.line_total),0)::text AS revenue,
              COUNT(*)::text AS cnt
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE o.order_date >= $1 AND i.is_counted_in_demand = true`,
      [since],
    );
    return result.rows[0];
  },

  async getTopSkus(start: Date, end: Date): Promise<TopSkuRow[]> {
    const result = await getPrimaryPool().query<TopSkuRow>(
      `SELECT i.master_sku,
              COALESCE(SUM(i.quantity),0)::text AS qty,
              COALESCE(SUM(i.line_total),0)::text AS revenue,
              COUNT(*)::text AS cnt
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE o.order_date >= $1 AND o.order_date <= $2
         AND i.is_counted_in_demand = true AND i.master_sku IS NOT NULL
       GROUP BY i.master_sku
       ORDER BY SUM(i.quantity) DESC
       LIMIT 10`,
      [start, end],
    );
    return result.rows;
  },

  async getRecentActivity(): Promise<RecentRow[]> {
    const result = await getPrimaryPool().query<RecentRow>(
      `SELECT i.master_sku, i.channel_sku, o.platform_source::text, o.order_date::text, i.quantity::text
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       ORDER BY o.created_at DESC LIMIT 10`,
    );
    return result.rows;
  },

  async getSalesTrend(start: Date, end: Date): Promise<DayRow[]> {
    const result = await getPrimaryPool().query<DayRow>(
      `SELECT o.order_date::date::text AS day,
              COALESCE(SUM(i.quantity),0)::text AS qty,
              COALESCE(SUM(i.line_total),0)::text AS revenue
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE o.order_date >= $1 AND o.order_date <= $2 AND i.is_counted_in_demand = true
       GROUP BY o.order_date::date
       ORDER BY o.order_date::date ASC`,
      [start, end],
    );
    return result.rows;
  },
};
