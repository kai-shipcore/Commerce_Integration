/**
 * Code Guide:
 * GET /api/compare — Compares units sold per master SKU between the Orders source
 * (ecommerce_data.sales_orders + sales_order_items via vw_sales_order_items mapping)
 * and the Velocity source (ecommerce_data.vw_sales_order_items_link) for the same
 * user-specified date range. Returns per-SKU differences to surface data inconsistencies.
 *
 * Key differences between sources:
 * - Orders uses SUM(net_quantity); Velocity uses COUNT(1) per row
 * - Velocity always filters to FULFILLED/Shipped + CA-SC* SKUs
 * - Velocity uses LA timezone for date boundaries; Orders uses UTC
 * - matchVelocityFilters=true applies the same status/SKU filters to the Orders side
 *   for an apples-to-apples comparison
 *
 * Uses a dedicated pool with connectionTimeoutMillis: 15s to handle cold-start
 * Supabase SSL latency (shared getLookupPool() uses only 2s).
 */

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export type CompareStatus = "match" | "mismatch" | "orders_only" | "velocity_only";

export interface CompareRow {
  masterSku: string;
  ordersQty: number;
  velocityQty: number;
  diff: number;
  diffPct: number | null;
  status: CompareStatus;
}

// Dedicated pool with 15s connection timeout to handle cold-start Supabase SSL handshakes.
let compareLookupPool: Pool | null = null;

function getCompareLookupPool(): Pool | null {
  const cs =
    process.env.SUPABASE_LOOKUP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    null;
  if (!cs) return null;
  if (!compareLookupPool) {
    compareLookupPool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
  }
  return compareLookupPool;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_SORT_COLS: Record<string, string> = {
  masterSku:    "master_sku",
  ordersQty:    "orders_qty",
  velocityQty:  "velocity_qty",
  diff:         "diff",
  absDiff:      "abs_diff",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const startDate = searchParams.get("startDate") ?? "";
  const endDate   = searchParams.get("endDate") ?? "";

  if (!startDate || !endDate || !ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
    return NextResponse.json(
      { success: false, error: "startDate and endDate are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const start = new Date(startDate);
  const end   = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return NextResponse.json(
      { success: false, error: "Invalid date range" },
      { status: 400 }
    );
  }
  const daysDiff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff > 365) {
    return NextResponse.json(
      { success: false, error: "Date range cannot exceed 365 days" },
      { status: 400 }
    );
  }

  const platformSource        = searchParams.get("platformSource") ?? "";
  const matchVelocityFilters  = searchParams.get("matchVelocityFilters") === "true";
  const statusFilter          = searchParams.get("status") ?? "";
  const search                = searchParams.get("search") ?? "";
  const sortBy                = VALID_SORT_COLS[searchParams.get("sortBy") ?? "absDiff"] ?? "abs_diff";
  const sortOrder             = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const page                  = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit                 = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? "100")));
  const offset                = (page - 1) * limit;

  // lagWarning: endDate is within 2 days of today (velocity has a 2-day lag)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysFromToday = Math.floor((today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
  const lagWarning = daysFromToday < 2;

  try {
    const lookupPool = getCompareLookupPool();
    if (!lookupPool) {
      return NextResponse.json(
        { success: false, error: "Supabase lookup DB is not configured" },
        { status: 503 }
      );
    }

    // ── Query 1: Orders side ─────────────────────────────────────────────────
    // SUM(net_quantity) per master_sku via vw_sales_order_items mapping
    const ordersParams: (string | string[])[] = [startDate, endDate];
    const ordersFilters = [
      "so.order_date >= $1::date",
      "so.order_date < ($2::date + INTERVAL '1 day')",
      "v.master_sku IS NOT NULL",
    ];
    if (platformSource) {
      ordersParams.push(platformSource);
      ordersFilters.push(`so.platform_source::text = $${ordersParams.length}`);
    }
    if (matchVelocityFilters) {
      ordersParams.push(["FULFILLED", "Shipped"]);
      ordersFilters.push(`soi.item_status = ANY($${ordersParams.length}::text[])`);
      ordersFilters.push("v.master_sku LIKE 'CA-SC%'");
    }

    // ── Query 2: Velocity side ───────────────────────────────────────────────
    // COUNT(1) per row in vw_sales_order_items_link, LA timezone
    const velParams: string[] = [startDate, endDate];
    const velFilters = [
      "master_sku IS NOT NULL",
      "master_sku LIKE 'CA-SC%'",
      "item_status IN ('FULFILLED', 'Shipped')",
      "(order_date AT TIME ZONE 'America/Los_Angeles')::date >= $1::date",
      "(order_date AT TIME ZONE 'America/Los_Angeles')::date < ($2::date + INTERVAL '1 day')",
    ];
    if (platformSource) {
      velParams.push(platformSource);
      velFilters.push(`platform_source::text = $${velParams.length}`);
    }

    // Run queries sequentially so the second query reuses the already-established
    // connection from the pool, avoiding double cold-start SSL timeout on parallel connects.
    const ordersRes = await lookupPool.query<{ master_sku: string; orders_qty: string }>(
      `SELECT
         v.master_sku,
         SUM(soi.net_quantity)::int::text AS orders_qty
       FROM ecommerce_data.sales_orders so
       JOIN ecommerce_data.sales_order_items soi ON soi.order_id = so.id
       JOIN ecommerce_data.vw_sales_order_items v ON v.order_sku = soi.sku
       WHERE ${ordersFilters.join(" AND ")}
       GROUP BY v.master_sku
       HAVING SUM(soi.net_quantity) != 0`,
      ordersParams
    );

    const velocityRes = await lookupPool.query<{ master_sku: string; velocity_qty: string }>(
      `SELECT
         master_sku,
         COUNT(1)::text AS velocity_qty
       FROM ecommerce_data.vw_sales_order_items_link
       WHERE ${velFilters.join(" AND ")}
       GROUP BY master_sku`,
      velParams
    );

    // ── Merge in-memory ──────────────────────────────────────────────────────
    const ordersMap  = new Map<string, number>();
    const velocityMap = new Map<string, number>();

    for (const row of ordersRes.rows)   ordersMap.set(row.master_sku, Number(row.orders_qty));
    for (const row of velocityRes.rows) velocityMap.set(row.master_sku, Number(row.velocity_qty));

    const allSkus = new Set([...ordersMap.keys(), ...velocityMap.keys()]);

    let rows: CompareRow[] = [];
    for (const sku of allSkus) {
      const ordersQty   = ordersMap.get(sku)   ?? 0;
      const velocityQty = velocityMap.get(sku) ?? 0;
      const diff = ordersQty - velocityQty;

      let status: CompareStatus;
      if (ordersQty > 0 && velocityQty === 0) status = "orders_only";
      else if (velocityQty > 0 && ordersQty === 0) status = "velocity_only";
      else if (diff === 0) status = "match";
      else status = "mismatch";

      const diffPct = velocityQty !== 0
        ? Math.round((diff / velocityQty) * 1000) / 10
        : null;

      rows.push({ masterSku: sku, ordersQty, velocityQty, diff, diffPct, status });
    }

    // ── Filter, sort, paginate ───────────────────────────────────────────────
    if (search) {
      const lower = search.toLowerCase();
      rows = rows.filter((r) => r.masterSku.toLowerCase().includes(lower));
    }
    if (statusFilter && ["match", "mismatch", "orders_only", "velocity_only"].includes(statusFilter)) {
      rows = rows.filter((r) => r.status === statusFilter);
    }

    rows.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortBy) {
        case "master_sku":    aVal = a.masterSku;    bVal = b.masterSku;    break;
        case "orders_qty":    aVal = a.ordersQty;    bVal = b.ordersQty;    break;
        case "velocity_qty":  aVal = a.velocityQty;  bVal = b.velocityQty;  break;
        case "diff":          aVal = a.diff;          bVal = b.diff;         break;
        case "abs_diff":
        default:              aVal = Math.abs(a.diff); bVal = Math.abs(b.diff); break;
      }
      if (typeof aVal === "string") {
        return sortOrder === "asc"
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      return sortOrder === "asc" ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    const total             = rows.length;
    const matchCount        = rows.filter((r) => r.status === "match").length;
    const mismatchCount     = rows.filter((r) => r.status === "mismatch").length;
    const ordersOnlyCount   = rows.filter((r) => r.status === "orders_only").length;
    const velocityOnlyCount = rows.filter((r) => r.status === "velocity_only").length;
    const totalOrdersQty    = rows.reduce((s, r) => s + r.ordersQty, 0);
    const totalVelocityQty  = rows.reduce((s, r) => s + r.velocityQty, 0);

    return NextResponse.json({
      success: true,
      data: rows.slice(offset, offset + limit),
      summary: {
        total,
        matchCount,
        mismatchCount,
        ordersOnlyCount,
        velocityOnlyCount,
        totalOrdersQty,
        totalVelocityQty,
      },
      meta: { startDate, endDate, matchVelocityFilters, lagWarning },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[compare] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
