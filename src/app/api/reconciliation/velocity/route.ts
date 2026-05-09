/**
 * Code Guide:
 * GET /api/reconciliation/velocity — Channel velocity for the /reconciliation page.
 * Bypasses the slow vw_sales_order_items view by querying ecommerce_data.sales_orders +
 * sales_order_items directly, then resolves master SKUs via lookupMasterSkusByOrderSkus.
 * Uses a dedicated pool with a 30s statement timeout.
 */

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { lookupMasterSkusByOrderSkus } from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

let velocityPool: Pool | null = null;

function getVelocityPool(): Pool | null {
  const cs =
    process.env.SUPABASE_LOOKUP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    null;
  if (!cs) return null;
  if (!velocityPool) {
    velocityPool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
  }
  return velocityPool;
}

const VALID_SORT_COLS: Record<string, keyof VelocityAgg> = {
  masterSku: "masterSku",
  qty90d: "qty90d",
  qty60d: "qty60d",
  qty30d: "qty30d",
  qty15d: "qty15d",
  qty7d: "qty7d",
};

interface VelocityAgg {
  masterSku: string;
  qty90d: number;
  qty60d: number;
  qty30d: number;
  qty15d: number;
  qty7d: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? "100")));
  const offset = (page - 1) * limit;
  const search = searchParams.get("search")?.trim() ?? "";
  const platformSource = searchParams.get("platformSource")?.trim() ?? "";
  const sortByKey = searchParams.get("sortBy") ?? "qty90d";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const sortCol = VALID_SORT_COLS[sortByKey] ?? "qty90d";

  try {
    const pool = getVelocityPool();
    if (!pool) {
      return NextResponse.json(
        { success: false, error: "Supabase lookup DB is not configured" },
        { status: 503 }
      );
    }

    const params: string[] = [];
    const filters = [
      `so.order_date >= NOW() - INTERVAL '90 days'`,
      "soi.sku IS NOT NULL",
      "soi.fulfillment_status = 'fulfilled'",
      "COALESCE(soi.unit_price, 0) > 0",
    ];

    if (platformSource) {
      params.push(platformSource);
      filters.push(`so.platform_source::text = $${params.length}`);
    }

    const client = await pool.connect();
    let rawRows: { sku: string; qty90d: string; qty60d: string; qty30d: string; qty15d: string; qty7d: string; }[] = [];
    try {
      await client.query("SET statement_timeout = 30000");
      const res = await client.query<{
        sku: string;
        qty90d: string;
        qty60d: string;
        qty30d: string;
        qty15d: string;
        qty7d: string;
      }>(
        `SELECT
           soi.sku,
           SUM(CASE WHEN so.order_date >= NOW() - INTERVAL '90 days' THEN soi.quantity ELSE 0 END)::text AS qty90d,
           SUM(CASE WHEN so.order_date >= NOW() - INTERVAL '60 days' THEN soi.quantity ELSE 0 END)::text AS qty60d,
           SUM(CASE WHEN so.order_date >= NOW() - INTERVAL '30 days' THEN soi.quantity ELSE 0 END)::text AS qty30d,
           SUM(CASE WHEN so.order_date >= NOW() - INTERVAL '15 days' THEN soi.quantity ELSE 0 END)::text AS qty15d,
           SUM(CASE WHEN so.order_date >= NOW() - INTERVAL '7 days'  THEN soi.quantity ELSE 0 END)::text AS qty7d
         FROM ecommerce_data.sales_orders so
         JOIN ecommerce_data.sales_order_items soi ON soi.order_id = so.id
         WHERE ${filters.join(" AND ")}
         GROUP BY soi.sku`,
        params
      );
      rawRows = res.rows;
    } finally {
      client.release();
    }

    // Resolve channel SKUs → master SKUs
    const distinctSkus = [...new Set(rawRows.map((r) => r.sku))];
    const skuToMaster = distinctSkus.length > 0
      ? await lookupMasterSkusByOrderSkus(distinctSkus)
      : new Map<string, string>();

    // Aggregate by master SKU
    const map = new Map<string, VelocityAgg>();
    for (const row of rawRows) {
      const masterSku = skuToMaster.get(row.sku);
      if (!masterSku) continue;
      const existing = map.get(masterSku) ?? { masterSku, qty90d: 0, qty60d: 0, qty30d: 0, qty15d: 0, qty7d: 0 };
      existing.qty90d += Number(row.qty90d);
      existing.qty60d += Number(row.qty60d);
      existing.qty30d += Number(row.qty30d);
      existing.qty15d += Number(row.qty15d);
      existing.qty7d  += Number(row.qty7d);
      map.set(masterSku, existing);
    }

    let rows = [...map.values()];

    if (search) {
      const lower = search.toLowerCase();
      rows = rows.filter((r) => r.masterSku.toLowerCase().includes(lower));
    }

    rows.sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (typeof aVal === "string") {
        return sortOrder === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }
      return sortOrder === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    const total = rows.length;
    const paginated = rows.slice(offset, offset + limit);

    const totals = rows.reduce(
      (acc, r) => {
        acc.qty90d += r.qty90d;
        acc.qty60d += r.qty60d;
        acc.qty30d += r.qty30d;
        acc.qty15d += r.qty15d;
        acc.qty7d  += r.qty7d;
        return acc;
      },
      { qty90d: 0, qty60d: 0, qty30d: 0, qty15d: 0, qty7d: 0, skuCount: total }
    );

    return NextResponse.json({
      success: true,
      data: paginated.map((r) => ({
        masterSku: r.masterSku,
        qty90d: r.qty90d,
        qty60d: r.qty60d,
        qty30d: r.qty30d,
        qty15d: r.qty15d,
        qty7d: r.qty7d,
      })),
      totals,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[reconciliation/velocity] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
