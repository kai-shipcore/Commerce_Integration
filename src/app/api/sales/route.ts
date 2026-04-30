/**
 * Code Guide:
 * This API route owns the sales backend workflow.
 * Reads from sc_sales_orders + sc_sales_order_items (primary DB).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

// GET /api/sales - Query sales data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const masterSkuCode = searchParams.get("masterSkuCode");
    const platform = searchParams.get("platform");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const groupBy = searchParams.get("groupBy"); // 'day' | 'week' | 'month'
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(500, parseInt(searchParams.get("limit") || "100"));
    const offset = (page - 1) * limit;

    const pool = getPrimaryPool();

    // Build dynamic WHERE conditions
    const conditions: string[] = ["i.is_counted_in_demand = true"];
    const params: unknown[] = [];
    let idx = 1;

    if (masterSkuCode) {
      conditions.push(`i.master_sku = $${idx++}`);
      params.push(masterSkuCode);
    }
    if (platform) {
      conditions.push(`o.platform_source::text = $${idx++}`);
      params.push(platform);
    }
    if (startDate) {
      conditions.push(`o.order_date >= $${idx++}`);
      params.push(new Date(startDate));
    }
    if (endDate) {
      conditions.push(`o.order_date <= $${idx++}`);
      params.push(new Date(endDate));
    }

    const where = conditions.join(" AND ");

    // Grouped aggregation
    if (groupBy && masterSkuCode) {
      let dateTrunc: string;
      if (groupBy === "month") dateTrunc = "month";
      else if (groupBy === "week") dateTrunc = "week";
      else dateTrunc = "day";

      const { rows } = await pool.query(
        `SELECT DATE_TRUNC('${dateTrunc}', o.order_date)::date::text AS date,
                COALESCE(SUM(i.quantity), 0)::int AS "totalQuantity",
                COALESCE(SUM(i.line_total), 0)::float AS "totalRevenue",
                COUNT(*)::int AS "orderCount"
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE ${where}
         GROUP BY DATE_TRUNC('${dateTrunc}', o.order_date)
         ORDER BY 1 ASC`,
        params
      );

      return NextResponse.json({ success: true, data: rows, groupBy });
    }

    // Individual records with pagination
    const [dataRes, countRes] = await Promise.all([
      pool.query(
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
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: dataRes.rows,
      pagination: {
        page,
        limit,
        total: countRes.rows[0].total,
        totalPages: Math.ceil(countRes.rows[0].total / limit),
      },
    });
  } catch (error: any) {
    console.error("Error fetching sales:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
