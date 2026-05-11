/**
 * Code Guide:
 * Standalone API for the Sales Link Report page.
 * It intentionally does not share the Velocity API surface so parallel work on /velocity stays isolated.
 */

import { NextRequest, NextResponse } from "next/server";
import { getLookupPool } from "@/lib/db/supabase-lookup";

const SORT_COLUMNS = {
  masterSku: "master_sku",
  qty90d: "qty_90d",
  qty60d: "qty_60d",
  qty30d: "qty_30d",
  qty15d: "qty_15d",
  qty7d: "qty_7d",
} as const;

type SortKey = keyof typeof SORT_COLUMNS;

function isSortKey(value: string): value is SortKey {
  return value in SORT_COLUMNS;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const pool = getLookupPool();

    if (!pool) {
      throw new Error("Lookup database connection is not configured");
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      500,
      Math.max(1, parseInt(searchParams.get("limit") || "100", 10)),
    );
    const offset = (page - 1) * limit;
    const search = searchParams.get("search")?.trim() || "";
    const asOfDateParam = searchParams.get("asOfDate")?.trim() || "";
    const sortByParam = searchParams.get("sortBy") || "masterSku";
    const sortOrder = searchParams.get("sortOrder") === "desc" ? "DESC" : "ASC";
    const sortColumn = isSortKey(sortByParam)
      ? SORT_COLUMNS[sortByParam]
      : SORT_COLUMNS.masterSku;
    const asOfDate = asOfDateParam && isIsoDate(asOfDateParam) ? asOfDateParam : null;

    const params: unknown[] = [asOfDate];
    const filters = [
      "master_sku IS NOT NULL",
      "master_sku LIKE 'CA-SC%'",
      "item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const baseCte = `
      WITH report_params AS (
        SELECT COALESCE($1::date, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date) AS as_of_date
      ),
      sales AS (
        SELECT
          master_sku,
          COUNT(*) FILTER (
            WHERE (order_date AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN (SELECT as_of_date FROM report_params) - INTERVAL '91 days'
                  AND (SELECT as_of_date FROM report_params) - INTERVAL '2 days'
          )::int AS qty_90d,
          COUNT(*) FILTER (
            WHERE (order_date AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN (SELECT as_of_date FROM report_params) - INTERVAL '61 days'
                  AND (SELECT as_of_date FROM report_params) - INTERVAL '2 days'
          )::int AS qty_60d,
          COUNT(*) FILTER (
            WHERE (order_date AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN (SELECT as_of_date FROM report_params) - INTERVAL '31 days'
                  AND (SELECT as_of_date FROM report_params) - INTERVAL '2 days'
          )::int AS qty_30d,
          COUNT(*) FILTER (
            WHERE (order_date AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN (SELECT as_of_date FROM report_params) - INTERVAL '16 days'
                  AND (SELECT as_of_date FROM report_params) - INTERVAL '2 days'
          )::int AS qty_15d,
          COUNT(*) FILTER (
            WHERE (order_date AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN (SELECT as_of_date FROM report_params) - INTERVAL '8 days'
                  AND (SELECT as_of_date FROM report_params) - INTERVAL '2 days'
          )::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items_link_new
        ${whereClause}
        GROUP BY master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    const [dataResult, totalsResult] = await Promise.all([
      pool.query<{
        master_sku: string;
        qty_90d: number;
        qty_60d: number;
        qty_30d: number;
        qty_15d: number;
        qty_7d: number;
        total_count: string;
      }>(
        `${baseCte}
        SELECT
          master_sku,
          qty_90d,
          qty_60d,
          qty_30d,
          qty_15d,
          qty_7d,
          COUNT(*) OVER ()::text AS total_count
        FROM sales
        ORDER BY ${sortColumn} ${sortOrder}, master_sku ASC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      ),
      pool.query<{
        total_90d: string;
        total_60d: string;
        total_30d: string;
        total_15d: string;
        total_7d: string;
        sku_count: string;
        as_of_date: string;
      }>(
        `${baseCte}
        SELECT
          COALESCE(SUM(qty_90d), 0)::text AS total_90d,
          COALESCE(SUM(qty_60d), 0)::text AS total_60d,
          COALESCE(SUM(qty_30d), 0)::text AS total_30d,
          COALESCE(SUM(qty_15d), 0)::text AS total_15d,
          COALESCE(SUM(qty_7d), 0)::text AS total_7d,
          COUNT(*)::text AS sku_count,
          (SELECT as_of_date::text FROM report_params) AS as_of_date
        FROM sales`,
        params,
      ),
    ]);

    const totals = totalsResult.rows[0];
    const totalRows = Number(totals?.sku_count ?? dataResult.rows[0]?.total_count ?? 0);

    return NextResponse.json({
      success: true,
      data: dataResult.rows.map((row) => ({
        masterSku: row.master_sku,
        qty90d: row.qty_90d,
        qty60d: row.qty_60d,
        qty30d: row.qty_30d,
        qty15d: row.qty_15d,
        qty7d: row.qty_7d,
      })),
      totals: {
        masterSku: "Total",
        qty90d: Number(totals?.total_90d ?? 0),
        qty60d: Number(totals?.total_60d ?? 0),
        qty30d: Number(totals?.total_30d ?? 0),
        qty15d: Number(totals?.total_15d ?? 0),
        qty7d: Number(totals?.total_7d ?? 0),
        skuCount: Number(totals?.sku_count ?? 0),
      },
      meta: {
        asOfDate: totals?.as_of_date ?? asOfDate,
        sourceView: "ecommerce_data.vw_sales_order_items_link_new",
        timezone: "America/Los_Angeles",
        excludesRecentDays: 2,
      },
      pagination: {
        page,
        limit,
        total: totalRows,
        totalPages: Math.ceil(totalRows / limit),
      },
    });
  } catch (error) {
    console.error("[sales-link-report] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
