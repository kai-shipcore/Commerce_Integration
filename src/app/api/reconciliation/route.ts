/**
 * Code Guide:
 * GET /api/reconciliation — Compares velocity channel data (Primary DB, sc_sales_order_items
 * with velocity filters) against orders data (Supabase, ecommerce_data.sales_orders +
 * sales_order_items) for the same time window and platform source.
 *
 * Uses a dedicated Supabase pool with a higher connectionTimeoutMillis (15s) to handle
 * cold-start SSL handshake latency — the shared getLookupPool() uses only 2s which is
 * too short when the pool has no warm connections on first load.
 *
 * Velocity filters: is_counted_in_demand=true, fulfillment_status='fulfilled', line_total>0
 * Orders side: net_quantity (refund-adjusted) from all line items, master_sku resolved via
 * lookupMasterSkusByOrderSkus (queries vw_sales_order_items filtered to the actual SKU list).
 */

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { lookupMasterSkusByOrderSkus } from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export type ReconciliationStatus = "match" | "mismatch" | "velocity_only" | "orders_only";

export interface ReconciliationRow {
  masterSku: string;
  platformSource: string;
  velocityQty: number;
  ordersQty: number;
  diff: number;
  diffPct: number | null;
  status: ReconciliationStatus;
}

// Dedicated pool with 15s connection timeout to handle cold-start Supabase SSL handshakes.
// The shared getLookupPool() uses 2s which is too tight for first-connection scenarios.
let reconciliationLookupPool: Pool | null = null;

function getReconciliationLookupPool(): Pool | null {
  const cs =
    process.env.SUPABASE_LOOKUP_DATABASE_URL ||
    process.env.DATABASE_URL ||
    null;
  if (!cs) return null;
  if (!reconciliationLookupPool) {
    reconciliationLookupPool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
  }
  return reconciliationLookupPool;
}

const ALLOWED_DAYS = new Set([7, 15, 30, 60, 90]);

const VALID_SORT_COLS: Record<string, string> = {
  masterSku: "master_sku",
  platformSource: "platform_source",
  velocityQty: "velocity_qty",
  ordersQty: "orders_qty",
  diff: "diff",
  absDiff: "abs_diff",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const daysRaw = Number(searchParams.get("days") ?? "30");
  const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : 30;
  const platformSource = searchParams.get("platformSource") ?? "";
  const search = searchParams.get("search") ?? "";
  const sortBy = VALID_SORT_COLS[searchParams.get("sortBy") ?? "absDiff"] ?? "abs_diff";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? "100")));
  const offset = (page - 1) * limit;
  const statusFilter = searchParams.get("status") ?? "";

  try {
    const primaryPool = getPrimaryPool();
    const lookupPool = getReconciliationLookupPool();

    // ── Primary DB: velocity channel data ────────────────────────────────────
    const primaryParams: string[] = [];
    const primaryFilters = [
      "i.is_counted_in_demand = true",
      "i.master_sku IS NOT NULL",
      `o.order_date >= NOW() - INTERVAL '${days} days'`,
      "i.fulfillment_status = 'fulfilled'",
      "i.line_total > 0",
    ];
    if (platformSource) {
      primaryParams.push(platformSource);
      primaryFilters.push(`o.platform_source::text = $${primaryParams.length}`);
    }

    // ── Supabase: Step 1 — aggregate by (platform_source, channel_sku) ───────
    const lookupParams: string[] = [];
    const lookupFilters = [
      `so.order_date >= NOW() - INTERVAL '${days} days'`,
      "soi.sku IS NOT NULL",
    ];
    if (platformSource) {
      lookupParams.push(platformSource);
      lookupFilters.push(`so.platform_source::text = $${lookupParams.length}`);
    }

    const [velocityRes, ordersSkuRes] = await Promise.all([
      primaryPool.query<{ platform_source: string; master_sku: string; qty: string }>(
        `SELECT
           o.platform_source::text AS platform_source,
           i.master_sku,
           SUM(i.quantity)::text AS qty
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE ${primaryFilters.join(" AND ")}
         GROUP BY o.platform_source, i.master_sku`,
        primaryParams
      ),
      lookupPool
        ? lookupPool.query<{ platform_source: string; sku: string; qty: string }>(
            `SELECT
               so.platform_source::text AS platform_source,
               soi.sku,
               SUM(soi.net_quantity)::text AS qty
             FROM ecommerce_data.sales_orders so
             JOIN ecommerce_data.sales_order_items soi ON soi.order_id = so.id
             WHERE ${lookupFilters.join(" AND ")}
             GROUP BY so.platform_source, soi.sku`,
            lookupParams
          )
        : Promise.resolve({ rows: [] as { platform_source: string; sku: string; qty: string }[] }),
    ]);

    // ── Supabase: Step 2 — resolve channel SKUs to master SKUs ───────────────
    // lookupMasterSkusByOrderSkus queries vw_sales_order_items filtered to the
    // provided SKU list — avoids a full table scan.
    const distinctSkus = [...new Set(ordersSkuRes.rows.map((r) => r.sku))];
    const skuToMasterSku = distinctSkus.length > 0
      ? await lookupMasterSkusByOrderSkus(distinctSkus)
      : new Map<string, string>();

    // ── Merge both sides in memory ───────────────────────────────────────────
    const map = new Map<string, {
      platformSource: string;
      masterSku: string;
      velocityQty: number;
      ordersQty: number;
    }>();

    for (const row of velocityRes.rows) {
      const key = `${row.platform_source}|${row.master_sku}`;
      const entry = map.get(key) ?? {
        platformSource: row.platform_source,
        masterSku: row.master_sku,
        velocityQty: 0,
        ordersQty: 0,
      };
      entry.velocityQty = Number(row.qty);
      map.set(key, entry);
    }

    for (const row of ordersSkuRes.rows) {
      const masterSku = skuToMasterSku.get(row.sku);
      if (!masterSku) continue;
      const key = `${row.platform_source}|${masterSku}`;
      const entry = map.get(key) ?? {
        platformSource: row.platform_source,
        masterSku,
        velocityQty: 0,
        ordersQty: 0,
      };
      entry.ordersQty += Number(row.qty);
      map.set(key, entry);
    }

    // ── Build reconciliation rows ────────────────────────────────────────────
    let rows: ReconciliationRow[] = [];
    for (const { masterSku, platformSource: ps, velocityQty, ordersQty } of map.values()) {
      const diff = velocityQty - ordersQty;
      let status: ReconciliationStatus;
      if (velocityQty > 0 && ordersQty === 0) status = "velocity_only";
      else if (velocityQty === 0 && ordersQty > 0) status = "orders_only";
      else if (diff === 0) status = "match";
      else status = "mismatch";

      const diffPct = ordersQty !== 0 ? Math.round((diff / ordersQty) * 1000) / 10 : null;
      rows.push({ masterSku, platformSource: ps, velocityQty, ordersQty, diff, diffPct, status });
    }

    // ── Apply search and status filters ─────────────────────────────────────
    if (search) {
      const lower = search.toLowerCase();
      rows = rows.filter((r) => r.masterSku.toLowerCase().includes(lower));
    }
    if (statusFilter && ["match", "mismatch", "velocity_only", "orders_only"].includes(statusFilter)) {
      rows = rows.filter((r) => r.status === statusFilter);
    }

    // ── Sort ─────────────────────────────────────────────────────────────────
    rows.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortBy) {
        case "master_sku":      aVal = a.masterSku;      bVal = b.masterSku;      break;
        case "platform_source": aVal = a.platformSource; bVal = b.platformSource; break;
        case "velocity_qty":    aVal = a.velocityQty;    bVal = b.velocityQty;    break;
        case "orders_qty":      aVal = a.ordersQty;      bVal = b.ordersQty;      break;
        case "diff":            aVal = a.diff;           bVal = b.diff;           break;
        case "abs_diff":
        default:                aVal = Math.abs(a.diff); bVal = Math.abs(b.diff); break;
      }
      if (typeof aVal === "string") {
        return sortOrder === "asc"
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      return sortOrder === "asc" ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    // ── Summary and pagination ───────────────────────────────────────────────
    const total = rows.length;
    const matchCount        = rows.filter((r) => r.status === "match").length;
    const mismatchCount     = rows.filter((r) => r.status === "mismatch").length;
    const velocityOnlyCount = rows.filter((r) => r.status === "velocity_only").length;
    const ordersOnlyCount   = rows.filter((r) => r.status === "orders_only").length;

    return NextResponse.json({
      success: true,
      data: rows.slice(offset, offset + limit),
      summary: { total, matchCount, mismatchCount, velocityOnlyCount, ordersOnlyCount },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[reconciliation] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
