/**
 * Data access for the (currently hidden, "Demand Signals") Sales page.
 * GET reads shipcore.sc_sales_orders/sc_sales_order_items (raw SQL) —
 * the same tables the Orders domain owns. Import instead resolves SKUs
 * against the legacy Prisma `SKU` catalog. That inconsistency predates
 * this refactor and is preserved as-is rather than unified.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";
import { prisma } from "@/lib/db/prisma";
import type { Pool, PoolClient } from "pg";

export type SqlExecutor = Pick<Pool, "query">;

function pool(): SqlExecutor {
  return getPrimaryPool();
}

export interface SalesFilters {
  masterSkuCode: string | null;
  platform: string | null;
  startDate: string | null;
  endDate: string | null;
}

function buildWhere(filters: SalesFilters): { where: string; params: unknown[] } {
  const conditions: string[] = ["i.is_counted_in_demand = true"];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.masterSkuCode) {
    conditions.push(`i.product_id = (SELECT id FROM shipcore.sc_products WHERE master_sku = $${idx++})`);
    params.push(filters.masterSkuCode);
  }
  if (filters.platform) {
    conditions.push(`o.platform_source::text = $${idx++}`);
    params.push(filters.platform);
  }
  if (filters.startDate) {
    conditions.push(`o.order_date >= $${idx++}`);
    params.push(new Date(filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(`o.order_date <= $${idx++}`);
    params.push(new Date(filters.endDate));
  }

  return { where: conditions.join(" AND "), params };
}

export const SalesRepository = {
  async listGrouped(filters: SalesFilters, dateTrunc: "day" | "week" | "month"): Promise<Record<string, unknown>[]> {
    const { where, params } = buildWhere(filters);
    const { rows } = await pool().query(
      `SELECT DATE_TRUNC('${dateTrunc}', o.order_date)::date::text AS date,
              o.platform_source::text AS platform,
              COALESCE(SUM(i.quantity), 0)::int AS "totalQuantity",
              COALESCE(SUM(i.line_total), 0)::float AS "totalRevenue",
              COUNT(*)::int AS "orderCount"
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE ${where}
       GROUP BY DATE_TRUNC('${dateTrunc}', o.order_date), o.platform_source
       ORDER BY 1 ASC, 2 ASC`,
      params,
    );
    return rows;
  },

  async listPaged(filters: SalesFilters, limit: number, offset: number): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const { where, params } = buildWhere(filters);
    const idx = params.length;

    const [dataRes, countRes] = await Promise.all([
      pool().query(
        `SELECT i.id, i.master_sku AS "masterSkuCode", i.channel_sku AS sku,
                i.product_name AS "skuName",
                o.platform_source::text AS platform,
                o.external_order_id AS "orderId",
                o.order_date AS "saleDate",
                i.quantity, i.unit_price AS "unitPrice", i.line_total AS "totalAmount",
                i.fulfillment_status AS "fulfillmentStatus"
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE ${where}
         ORDER BY o.order_date DESC
         LIMIT $${idx + 1} OFFSET $${idx + 2}`,
        [...params, limit, offset],
      ),
      pool().query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE ${where}`,
        params,
      ),
    ]);

    return { rows: dataRes.rows, total: countRes.rows[0].total };
  },

  findSkusByCode(skuCodes: string[]) {
    return prisma.sKU.findMany({ where: { skuCode: { in: skuCodes } }, select: { id: true, skuCode: true } });
  },

  createMissingSkus(skuCodes: string[]) {
    return prisma.sKU.createManyAndReturn({
      data: skuCodes.map((code) => ({ skuCode: code, name: code, currentStock: 0 })),
      select: { id: true, skuCode: true },
    });
  },

  async upsertOrder(
    client: PoolClient,
    input: { externalOrderId: string; platform: string; saleDate: Date; totalAmount: number; isCounted: boolean },
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO shipcore.sc_sales_orders (
         platform_source, external_order_id, order_number,
         order_date, order_status,
         total_price, is_counted_in_demand
       ) VALUES ($1, $2, $2, $3, 'completed', $4, $5)
       ON CONFLICT (external_order_id) DO UPDATE SET
         total_price = EXCLUDED.total_price,
         updated_at  = NOW()
       RETURNING id`,
      [input.platform, input.externalOrderId, input.saleDate, input.totalAmount, input.isCounted],
    );
    return res.rows[0].id;
  },

  async upsertOrderItem(
    client: PoolClient,
    input: {
      orderId: string; platform: string; lineItemId: string; skuCode: string;
      quantity: number; unitPrice: number; totalAmount: number; fulfillmentStatus: string; isCounted: boolean;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO shipcore.sc_sales_order_items (
         order_id, platform_source, external_line_item_id,
         master_sku, channel_sku, sku,
         quantity, unit_price, line_total,
         fulfillment_status,
         is_counted_in_demand
       ) VALUES ($1, $2, $3, $4, $4, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (external_line_item_id) DO UPDATE SET
         quantity             = EXCLUDED.quantity,
         unit_price           = EXCLUDED.unit_price,
         line_total           = EXCLUDED.line_total,
         fulfillment_status   = EXCLUDED.fulfillment_status,
         is_counted_in_demand = EXCLUDED.is_counted_in_demand,
         updated_at           = NOW()`,
      [
        input.orderId, input.platform, input.lineItemId,
        input.skuCode,
        input.quantity, input.unitPrice, input.totalAmount,
        input.fulfillmentStatus,
        input.isCounted,
      ],
    );
  },

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPrimaryPool().connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  },
};
