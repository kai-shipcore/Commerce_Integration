/**
 * Code Guide:
 * Connection pool and write helpers for the primary PostgreSQL database (DATABASE_URL).
 * All sync functions that write to the new DB live here.
 * Read-only helpers for the old Supabase lookup DB live in supabase-lookup.ts.
 */

import { Pool } from "pg";

let primaryPool: Pool | null = null;

export function getPrimaryPool(): Pool {
  if (!primaryPool) {
    primaryPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "",
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return primaryPool;
}

export async function getSalesOrdersPrimary(options: {
  page?: number;
  limit?: number;
  exportAll?: boolean;
  search?: string;
  platformSource?: string;
  orderStatus?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const pool = getPrimaryPool();
  const page = Math.max(1, options.page ?? 1);
  const limit = options.exportAll ? 100000 : Math.min(200, options.limit ?? 20);
  const offset = (page - 1) * limit;
  const sortOrder = options.sortOrder === "asc" ? "ASC" : "DESC";
  const sortColMap: Record<string, string> = {
    orderDate: "o.order_date",
    orderNumber: "o.order_number",
    platformSource: "o.platform_source",
    orderStatus: "o.order_status",
    totalPrice: "o.total_price",
    lineCount: "line_count",
    unitCount: "unit_count",
  };
  const sortCol = sortColMap[options.sortBy ?? "orderDate"] ?? "o.order_date";

  const filters: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (options.search?.trim()) {
    params.push(`%${options.search.trim()}%`);
    filters.push(
      `(COALESCE(o.order_number,'') ILIKE $${idx} OR COALESCE(o.external_order_id,'') ILIKE $${idx})`
    );
    idx++;
  }
  if (options.platformSource && options.platformSource !== "all") {
    params.push(options.platformSource);
    filters.push(`o.platform_source::text = $${idx++}`);
  }
  if (options.orderStatus && options.orderStatus !== "all") {
    params.push(options.orderStatus);
    filters.push(`o.order_status = $${idx++}`);
  }
  if (options.startDate) {
    params.push(options.startDate);
    filters.push(`o.order_date >= $${idx++}::date`);
  }
  if (options.endDate) {
    params.push(options.endDate);
    filters.push(`o.order_date < ($${idx++}::date + INTERVAL '1 day')`);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const limitIdx = idx++;
  const offsetIdx = idx;

  const [summaryRes, platformRes, statusRes, dataRes, countRes] = await Promise.all([
    pool.query<{
      total_orders: number;
      total_revenue: string;
      total_units: number;
      total_platforms: number;
    }>(
      `SELECT COUNT(DISTINCT o.id)::int AS total_orders,
              COALESCE(SUM(o.total_price),0)::text AS total_revenue,
              COALESCE(SUM(sub.qty),0)::int AS total_units,
              COUNT(DISTINCT o.platform_source)::int AS total_platforms
       FROM shipcore.sc_sales_orders o
       LEFT JOIN (
         SELECT order_id, SUM(quantity) AS qty
         FROM shipcore.sc_sales_order_items GROUP BY order_id
       ) sub ON sub.order_id = o.id
       ${where}`,
      params
    ),
    pool.query<{ platform_source: string }>(
      `SELECT DISTINCT platform_source::text AS platform_source
       FROM shipcore.sc_sales_orders ORDER BY 1`
    ),
    pool.query<{ order_status: string }>(
      `SELECT DISTINCT order_status
       FROM shipcore.sc_sales_orders
       WHERE order_status IS NOT NULL ORDER BY 1`
    ),
    pool.query(
      `SELECT o.id, o.platform_source::text, o.external_order_id, o.order_number,
              o.order_date, o.order_status,
              COALESCE(o.total_price,0)::text AS total_price,
              o.currency::text,
              COUNT(i.id)::int AS line_count,
              COALESCE(SUM(i.quantity),0)::int AS unit_count
       FROM shipcore.sc_sales_orders o
       LEFT JOIN shipcore.sc_sales_order_items i ON i.order_id = o.id
       ${where}
       GROUP BY o.id, o.platform_source, o.external_order_id, o.order_number,
                o.order_date, o.order_status, o.total_price, o.currency
       ORDER BY ${sortCol} ${sortOrder}, o.id DESC
       ${options.exportAll ? "" : `LIMIT $${limitIdx} OFFSET $${offsetIdx}`}`,
      options.exportAll ? params : [...params, limit, offset]
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(DISTINCT o.id)::int AS total
       FROM shipcore.sc_sales_orders o ${where}`,
      params
    ),
  ]);

  const s = summaryRes.rows[0];
  return {
    rows: dataRes.rows.map((r) => ({
      id: r.id as number,
      platformSource: r.platform_source as string,
      externalOrderId: r.external_order_id as string | null,
      orderNumber: r.order_number as string | null,
      orderDate:
        r.order_date instanceof Date
          ? r.order_date.toISOString()
          : (r.order_date as string | null),
      orderStatus: r.order_status as string | null,
      totalPrice: Number(r.total_price ?? 0),
      currency: r.currency as string | null,
      lineCount: Number(r.line_count ?? 0),
      unitCount: Number(r.unit_count ?? 0),
    })),
    totalRows: countRes.rows[0].total,
    platformSources: platformRes.rows.map((r) => r.platform_source),
    orderStatuses: statusRes.rows.map((r) => r.order_status),
    summary: {
      totalOrders: s.total_orders,
      totalRevenue: Number(s.total_revenue ?? 0),
      totalUnits: s.total_units,
      totalPlatforms: s.total_platforms,
    },
  };
}

export async function getSalesOrderDetailPrimary(orderId: number) {
  const pool = getPrimaryPool();
  const [orderRes, itemsRes] = await Promise.all([
    pool.query(
      `SELECT id, platform_source::text, external_order_id, order_number,
              order_date, order_status, total_price, currency::text,
              fulfillment_channel, cancelled_at
       FROM shipcore.sc_sales_orders WHERE id = $1`,
      [orderId]
    ),
    pool.query(
      `SELECT id, master_sku, channel_sku, product_name, quantity,
              unit_price, line_total, fulfillment_status
       FROM shipcore.sc_sales_order_items
       WHERE order_id = $1 ORDER BY id`,
      [orderId]
    ),
  ]);

  if (!orderRes.rows.length) return null;

  const o = orderRes.rows[0];
  return {
    id: o.id as number,
    platformSource: o.platform_source as string,
    externalOrderId: o.external_order_id as string | null,
    orderNumber: o.order_number as string | null,
    orderDate:
      o.order_date instanceof Date
        ? o.order_date.toISOString()
        : (o.order_date as string | null),
    orderStatus: o.order_status as string | null,
    totalPrice: Number(o.total_price ?? 0),
    currency: o.currency as string | null,
    fulfillmentChannel: o.fulfillment_channel as string | null,
    cancelledAt:
      o.cancelled_at instanceof Date
        ? o.cancelled_at.toISOString()
        : (o.cancelled_at as string | null),
    lineItems: itemsRes.rows.map((i) => ({
      id: i.id as number,
      masterSku: i.master_sku as string | null,
      channelSku: i.channel_sku as string | null,
      productName: i.product_name as string | null,
      quantity: Number(i.quantity ?? 0),
      unitPrice: Number(i.unit_price ?? 0),
      lineTotal: Number(i.line_total ?? 0),
      fulfillmentStatus: i.fulfillment_status as string | null,
    })),
  };
}
