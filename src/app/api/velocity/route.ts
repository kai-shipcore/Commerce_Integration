/**
 * Code Guide:
 * GET /api/velocity — Master SKU velocity: units sold per rolling window (90D~7D).
 * platformSource param filters by ecommerce_data.vw_sales_order_items.platform_source (Channel tab).
 * Reads channel velocity from Supabase ecommerce_data views.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCustomSalesVelocity,
  getLinkSalesVelocity,
  getLookupPool,
} from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const VALID_SORT_COLS = {
  masterSku: "master_sku",
  qty90d: "qty_90d",
  qty60d: "qty_60d",
  qty30d: "qty_30d",
  qty15d: "qty_15d",
  qty7d: "qty_7d",
} as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isExport = searchParams.get("export") === "1";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = isExport ? 10000 : Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));
    const offset = (page - 1) * limit;
    const search = searchParams.get("search")?.trim() ?? "";
    const platformSource = searchParams.get("platformSource")?.trim() ?? "";
    const fulfillmentChannel = searchParams.get("fulfillmentChannel")?.trim() ?? "";
    const sortByKey = searchParams.get("sortBy") ?? "qty90d";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "ASC" : "DESC";
    const sortCol =
      sortByKey in VALID_SORT_COLS
        ? VALID_SORT_COLS[sortByKey as keyof typeof VALID_SORT_COLS]
        : "qty_90d";
    const source = searchParams.get("source")?.trim() ?? "";

    if (source === "link") {
      const result = await getLinkSalesVelocity({ search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      const t = result.totals;
      return NextResponse.json({
        success: true,
        data: result.rows.map((r) => ({
          masterSku: r.master_sku,
          qty90d: r.qty_90d, qty60d: r.qty_60d, qty30d: r.qty_30d,
          qty15d: r.qty_15d, qty7d: r.qty_7d,
          customMasterSku: null,
          customQty90d: null, customQty60d: null, customQty30d: null,
          customQty15d: null, customQty7d: null,
        })),
        totals: {
          qty90d: Number(t?.total_90d ?? 0),
          qty60d: Number(t?.total_60d ?? 0),
          qty30d: Number(t?.total_30d ?? 0),
          qty15d: Number(t?.total_15d ?? 0),
          qty7d:  Number(t?.total_7d  ?? 0),
          skuCount: Number(t?.sku_count ?? 0),
        },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }

    if (source === "custom") {
      const result = await getCustomSalesVelocity({ search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      const t = result.totals;
      return NextResponse.json({
        success: true,
        data: result.rows.map((r) => ({
          masterSku: r.master_sku,
          qty90d: r.qty_90d, qty60d: r.qty_60d, qty30d: r.qty_30d,
          qty15d: r.qty_15d, qty7d: r.qty_7d,
          customMasterSku: null,
        })),
        totals: {
          qty90d: Number(t?.total_90d ?? 0),
          qty60d: Number(t?.total_60d ?? 0),
          qty30d: Number(t?.total_30d ?? 0),
          qty15d: Number(t?.total_15d ?? 0),
          qty7d:  Number(t?.total_7d  ?? 0),
          skuCount: Number(t?.sku_count ?? 0),
        },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }

    const pool = getLookupPool();

    if (!pool) {
      throw new Error("No lookup database connection configured");
    }

    const params: (string | number)[] = [];
    const filters: string[] = [
      "master_sku IS NOT NULL",
      "order_date >= NOW() - INTERVAL '90 days'",
      "quantity > 0",
      "item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (platformSource) {
      params.push(platformSource);
      filters.push(`platform_source::text = $${params.length}`);
    }

    if (fulfillmentChannel) {
      params.push(fulfillmentChannel);
      filters.push(`fulfillment_channel::text = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          master_sku,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '90 days' THEN quantity ELSE 0 END)::int AS qty_90d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '60 days' THEN quantity ELSE 0 END)::int AS qty_60d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '30 days' THEN quantity ELSE 0 END)::int AS qty_30d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '15 days' THEN quantity ELSE 0 END)::int AS qty_15d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '7 days'  THEN quantity ELSE 0 END)::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items
        ${whereClause}
        GROUP BY master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    const [dataRes, totalsRes] = await Promise.all([
      pool.query<{
        master_sku: string;
        qty_90d: number; qty_60d: number; qty_30d: number; qty_15d: number; qty_7d: number;
        total_count: string;
      }>(
        `${pivotCte}
        SELECT
          master_sku,
          qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
          COUNT(*) OVER ()::text AS total_count
        FROM velocity
        ORDER BY ${sortCol} ${sortOrder}, master_sku ASC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      pool.query<{
        total_90d: string; total_60d: string; total_30d: string; total_15d: string; total_7d: string;
        sku_count: string;
      }>(
        `${pivotCte}
        SELECT
          COALESCE(SUM(qty_90d), 0)::text AS total_90d,
          COALESCE(SUM(qty_60d), 0)::text AS total_60d,
          COALESCE(SUM(qty_30d), 0)::text AS total_30d,
          COALESCE(SUM(qty_15d), 0)::text AS total_15d,
          COALESCE(SUM(qty_7d),  0)::text AS total_7d,
          COUNT(*)::text AS sku_count
        FROM velocity`,
        params
      ),
    ]);

    const total = Number(dataRes.rows[0]?.total_count ?? 0);
    const t = totalsRes.rows[0];

    return NextResponse.json({
      success: true,
      data: dataRes.rows.map((r) => ({
        masterSku: r.master_sku,
        qty90d: r.qty_90d, qty60d: r.qty_60d, qty30d: r.qty_30d,
        qty15d: r.qty_15d, qty7d: r.qty_7d,
        customMasterSku: null,
      })),
      totals: {
        qty90d: Number(t?.total_90d ?? 0),
        qty60d: Number(t?.total_60d ?? 0),
        qty30d: Number(t?.total_30d ?? 0),
        qty15d: Number(t?.total_15d ?? 0),
        qty7d:  Number(t?.total_7d  ?? 0),
        skuCount: Number(t?.sku_count ?? 0),
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[velocity] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
