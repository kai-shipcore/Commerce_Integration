// Code Guide: POST /api/planning/stats/refresh — Phase 2 stats refresh.
// Step 1: inventory — reads ecommerce_data.coverland_inventory_by_warehouse (lookup pool) and upserts
//         west_stock, east_stock, total_stock, back, and per-warehouse stocks into shipcore.fc_stats.
//         Warehouse mapping: Fullerton+Canary → west, TTM Group+TTM Group Jefferson → east.
// Step 2: sales velocity — reads both snapshots; sales_status derived from is_custom column:
//         is_custom = 'Y' → 'Custom', is_custom = 'N' → 'Original'
//         fc_velocity_link_snapshot → fc_stats, fc_velocity_custom_snapshot → fc_stats_custom
//         order_type mapping: 'sales' → west, 'ttm' → east, 'preorder' → west_30d_pre.
//         No trailing lag — windows use the LA planning date to match the dashboard.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { planningLocalDateString } from "@/lib/planning/date-utils";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";
import {
  currentDailyAverage,
  fbmThirtyDayAverage,
  forecastCategoryCodeForSku,
} from "@/lib/planning/forecast-calculations";
import { DEFAULT_SALES_WINDOW_WEIGHTS, normalizeSalesWindowWeights } from "@/lib/planning/sales-window-weights";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const BATCH = 500;

function planningDateQuery(sql: string): string {
  return sql.replaceAll("CURRENT_DATE", "$1::date");
}

async function batchUpsert(
  primary: ReturnType<typeof getPrimaryPool>,
  table: "shipcore.fc_stats" | "shipcore.fc_stats_custom",
  rows: Record<string, unknown>[],
  columns: string[],
  updateSet: string,
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch  = rows.slice(i, i + BATCH);
    const values = batch
      .map((_, j) => {
        const base = j * columns.length;
        return `(${columns.map((_, k) => `$${base + k + 1}`).join(", ")})`;
      })
      .join(", ");
    const params = batch.flatMap((r) => columns.map((c) => r[c]));
    await primary.query(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES ${values}
       ON CONFLICT (master_sku) DO UPDATE SET ${updateSet}`,
      params,
    );
  }
}

export async function POST(request: Request) {
  try {
    const lookup  = getLookupPool();
    const primary = getPrimaryPool();
    const requestBody = await request.json().catch(() => null) as { salesWindowWeights?: unknown } | null;
    const salesWindowWeights = requestBody?.salesWindowWeights
      ? normalizeSalesWindowWeights(requestBody.salesWindowWeights)
      : DEFAULT_SALES_WINDOW_WEIGHTS;

    if (!lookup) {
      return NextResponse.json(
        { success: false, error: "No database connection available" },
        { status: 500 },
      );
    }

    // ── Step 1: Inventory from coverland_inventory_by_warehouse ─────────────
    const invResult = await lookup.query<{
      master_sku:           string;
      west_stock:           number;
      east_stock:           number;
      total_stock:          number;
      back:                 number;
      west_available_stock: number;
      east_available_stock: number;
      fullerton_stock:              number;
      canary_stock:                 number;
      ttm_stock:                    number;
      ttm_jeff_stock:               number;
      fullerton_available_stock:    number;
      canary_available_stock:       number;
      ttm_available_stock:          number;
      ttm_jeff_available_stock:     number;
    }>(`
      WITH normalized_inventory AS (
        SELECT
          ${normalizedMasterSkuSql("master_sku")} AS master_sku,
          warehouse,
          on_hand,
          available,
          backorder
        FROM ecommerce_data.coverland_inventory_by_warehouse
        WHERE master_sku IS NOT NULL AND BTRIM(master_sku) <> ''
      )
      SELECT
        master_sku,
        SUM(CASE WHEN warehouse IN ('Fullerton','Canary')                 THEN COALESCE(on_hand,   0) ELSE 0 END)::int  AS west_stock,
        SUM(CASE WHEN warehouse IN ('TTM Group','TTM Group Jefferson')    THEN COALESCE(on_hand,   0) ELSE 0 END)::int  AS east_stock,
        SUM(COALESCE(on_hand,   0))::int                                                                                AS total_stock,
        -SUM(COALESCE(backorder, 0))::int                                                                               AS back,
        SUM(CASE WHEN warehouse IN ('Fullerton','Canary')                 THEN COALESCE(available, 0) ELSE 0 END)::int  AS west_available_stock,
        SUM(CASE WHEN warehouse IN ('TTM Group','TTM Group Jefferson')    THEN COALESCE(available, 0) ELSE 0 END)::int  AS east_available_stock,
        SUM(CASE WHEN warehouse = 'Fullerton'           THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS fullerton_stock,
        SUM(CASE WHEN warehouse = 'Canary'              THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS canary_stock,
        SUM(CASE WHEN warehouse = 'TTM Group'           THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS ttm_stock,
        SUM(CASE WHEN warehouse = 'TTM Group Jefferson' THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS ttm_jeff_stock,
        SUM(CASE WHEN warehouse = 'Fullerton'           THEN COALESCE(available, 0) ELSE 0 END)::int                   AS fullerton_available_stock,
        SUM(CASE WHEN warehouse = 'Canary'              THEN COALESCE(available, 0) ELSE 0 END)::int                   AS canary_available_stock,
        SUM(CASE WHEN warehouse = 'TTM Group'           THEN COALESCE(available, 0) ELSE 0 END)::int                   AS ttm_available_stock,
        SUM(CASE WHEN warehouse = 'TTM Group Jefferson' THEN COALESCE(available, 0) ELSE 0 END)::int                   AS ttm_jeff_available_stock
      FROM normalized_inventory
      GROUP BY master_sku
    `);

    const invRows = invResult.rows as Record<string, unknown>[];
    const invCols = ["master_sku", "west_stock", "east_stock", "total_stock", "back", "west_available_stock", "east_available_stock", "fullerton_stock", "canary_stock", "ttm_stock", "ttm_jeff_stock", "fullerton_available_stock", "canary_available_stock", "ttm_available_stock", "ttm_jeff_available_stock"];
    const invUpdate = `west_stock                    = EXCLUDED.west_stock,
       east_stock                    = EXCLUDED.east_stock,
       total_stock                   = EXCLUDED.total_stock,
       back                          = EXCLUDED.back,
       west_available_stock          = EXCLUDED.west_available_stock,
       east_available_stock          = EXCLUDED.east_available_stock,
       fullerton_stock               = EXCLUDED.fullerton_stock,
       canary_stock                  = EXCLUDED.canary_stock,
       ttm_stock                     = EXCLUDED.ttm_stock,
       ttm_jeff_stock                = EXCLUDED.ttm_jeff_stock,
       fullerton_available_stock     = EXCLUDED.fullerton_available_stock,
       canary_available_stock        = EXCLUDED.canary_available_stock,
       ttm_available_stock           = EXCLUDED.ttm_available_stock,
       ttm_jeff_available_stock      = EXCLUDED.ttm_jeff_available_stock,
       calculated_at                 = NOW(),
       updated_at                    = NOW()`;
    await Promise.all([
      batchUpsert(primary, "shipcore.fc_stats",        invRows, invCols, invUpdate),
      batchUpsert(primary, "shipcore.fc_stats_custom", invRows, invCols, invUpdate),
    ]);

    // ── Step 2: Sales velocity ───────────────────────────────────────────────
    const planningDate = planningLocalDateString();

    // Zero out velocity + avg columns first so SKUs with no recent sales show 0.
    const zeroVelocity = `
      west_90d = 0, west_60d = 0, west_30d = 0, west_15d = 0, west_7d = 0, west_30d_pre = 0,
      east_90d = 0, east_60d = 0, east_30d = 0, east_15d = 0, east_7d = 0, east_30d_pre = 0,
      avg_daily_real = 0, avg_daily_prev = 0, avg_daily_curr = 0,
      east_avg_real  = 0, east_avg_prev  = 0, east_avg_curr  = 0,
      total_avg_prev = 0, total_avg_real = 0, total_avg_curr = 0,
      west_fbm_30d   = 0, east_fbm_30d   = 0, total_30d = 0,
      fba_avg_prev   = 0, fba_avg_real   = 0, fba_avg_curr   = 0, fba_30d = 0,
      updated_at = NOW()`;
    await Promise.all([
      primary.query(`UPDATE shipcore.fc_stats        SET ${zeroVelocity}`),
      primary.query(`UPDATE shipcore.fc_stats_custom SET ${zeroVelocity}`),
    ]);

    // All SKUs — fc_velocity_link_snapshot → written to fc_stats
    // WHERE extends to the LA planning date - 98 to cover the prev window (shifted back 7 days).
    const linkSalesResult = await primary.query(planningDateQuery(`
      SELECT
        vls.link_master_sku AS master_sku,
        CASE WHEN MAX(vls.is_custom) = 'Y' THEN 'Custom' ELSE 'Original' END AS sales_status,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS west_90d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS west_60d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS west_30d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS west_15d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS west_7d,
        SUM(CASE WHEN order_type = 'preorder' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS west_30d_pre,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS east_90d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS east_60d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS east_30d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS east_15d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric AS east_7d,
        0::numeric AS east_30d_pre,
        -- avg_daily_real (west, FBA excluded): weighted avg over current window
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS avg_daily_real,
        -- avg_daily_prev (west, FBA excluded): same formula, windows shifted back 7 days
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS avg_daily_prev,
        -- east_avg_real (ttm + preorder): same weighted formula as west
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS east_avg_real,
        -- east_avg_prev (ttm + preorder): shifted back 7 days
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS east_avg_prev,
        -- fba_avg_real (FBA): same weighted formula as west/east
        GREATEST(0.01, (
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_type = 'preorder' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS fba_avg_real,
        -- fba_avg_prev (FBA): same formula, windows shifted back 7 days
        GREATEST(0.01, (
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_type = 'preorder' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS fba_avg_prev,
        -- fba raw windows (used to exclude FBA from west_fbm_30d)
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::int AS fba_90d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::int AS fba_60d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::int AS fba_30d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::int AS fba_15d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::int AS fba_7d
      FROM shipcore.fc_velocity_link_snapshot vls
      WHERE vls.link_master_sku IS NOT NULL
        AND vls.order_date >= CURRENT_DATE - 98
      GROUP BY vls.link_master_sku
    `), [planningDate]);

    // All SKUs — fc_velocity_custom_snapshot → written to fc_stats_custom
    const customSalesResult = await primary.query(planningDateQuery(`
      SELECT
        vcs.custom_master_sku AS master_sku,
        CASE WHEN MAX(vcs.is_custom) = 'Y' THEN 'Custom' ELSE 'Original' END AS sales_status,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS west_90d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS west_60d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS west_30d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS west_15d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS west_7d,
        SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS west_30d_pre,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS east_90d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS east_60d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS east_30d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS east_15d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric AS east_7d,
        0::numeric AS east_30d_pre,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS avg_daily_real,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS avg_daily_prev,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS east_avg_real,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS east_avg_prev,
        GREATEST(0.01, (
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_type = 'preorder' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS fba_avg_real,
        GREATEST(0.01, (
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_type = 'preorder' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        )) AS fba_avg_prev,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::int AS fba_90d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::int AS fba_60d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::int AS fba_30d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::int AS fba_15d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::int AS fba_7d
      FROM shipcore.fc_velocity_custom_snapshot vcs
      WHERE vcs.custom_master_sku IS NOT NULL
        AND vcs.order_date >= CURRENT_DATE - 98
      GROUP BY vcs.custom_master_sku
    `), [planningDate]);

    const salesCols = [
      "master_sku", "sales_status",
      "west_90d", "west_60d", "west_30d", "west_15d", "west_7d", "west_30d_pre",
      "east_90d", "east_60d", "east_30d", "east_15d", "east_7d", "east_30d_pre",
      "avg_daily_real", "avg_daily_prev", "avg_daily_curr",
      "east_avg_real",  "east_avg_prev",  "east_avg_curr",
      "total_avg_prev", "total_avg_real", "total_avg_curr",
      "west_fbm_30d",   "east_fbm_30d",   "total_30d",
      "fba_avg_prev",   "fba_avg_real",   "fba_avg_curr",   "fba_30d",
    ];
    const salesUpdateSet = `
      sales_status    = EXCLUDED.sales_status,
      west_90d        = EXCLUDED.west_90d,
      west_60d        = EXCLUDED.west_60d,
      west_30d        = EXCLUDED.west_30d,
      west_15d        = EXCLUDED.west_15d,
      west_7d         = EXCLUDED.west_7d,
      west_30d_pre    = EXCLUDED.west_30d_pre,
      east_90d        = EXCLUDED.east_90d,
      east_60d        = EXCLUDED.east_60d,
      east_30d        = EXCLUDED.east_30d,
      east_15d        = EXCLUDED.east_15d,
      east_7d         = EXCLUDED.east_7d,
      east_30d_pre    = EXCLUDED.east_30d_pre,
      avg_daily_real  = EXCLUDED.avg_daily_real,
      avg_daily_prev  = EXCLUDED.avg_daily_prev,
      avg_daily_curr  = EXCLUDED.avg_daily_curr,
      east_avg_real   = EXCLUDED.east_avg_real,
      east_avg_prev   = EXCLUDED.east_avg_prev,
      east_avg_curr   = EXCLUDED.east_avg_curr,
      total_avg_prev  = EXCLUDED.total_avg_prev,
      total_avg_real  = EXCLUDED.total_avg_real,
      total_avg_curr  = EXCLUDED.total_avg_curr,
      west_fbm_30d    = EXCLUDED.west_fbm_30d,
      east_fbm_30d    = EXCLUDED.east_fbm_30d,
      total_30d       = EXCLUDED.total_30d,
      fba_avg_prev    = EXCLUDED.fba_avg_prev,
      fba_avg_real    = EXCLUDED.fba_avg_real,
      fba_avg_curr    = EXCLUDED.fba_avg_curr,
      fba_30d         = EXCLUDED.fba_30d,
      calculated_at   = NOW(),
      updated_at      = NOW()`;

    const linkRows   = linkSalesResult.rows   as Record<string, unknown>[];
    const customRows = customSalesResult.rows as Record<string, unknown>[];

    for (const r of [...linkRows, ...customRows]) {
      // Keep source precision for calculations; UI can round display values separately.
      const categoryCode = forecastCategoryCodeForSku(String(r.master_sku));
      const wPrev   = Number(r.avg_daily_prev);
      const wReal   = Number(r.avg_daily_real);
      const ePrev   = Number(r.east_avg_prev);
      const eReal   = Number(r.east_avg_real);
      const fbaPrev = Number(r.fba_avg_prev ?? 0);
      const fbaReal = Number(r.fba_avg_real ?? 0);
      const wCurr   = currentDailyAverage(wPrev, wReal, categoryCode);
      const eCurr   = currentDailyAverage(ePrev, eReal, categoryCode);
      const fbaCurr = currentDailyAverage(fbaPrev, fbaReal, categoryCode);

      r.avg_daily_prev  = wPrev;
      r.avg_daily_real  = wReal;
      r.east_avg_prev   = ePrev;
      r.east_avg_real   = eReal;
      r.avg_daily_curr  = wCurr;
      r.east_avg_curr   = eCurr;
      r.total_avg_prev  = wPrev + ePrev + fbaPrev;
      r.total_avg_real  = wReal + eReal + fbaReal;
      r.total_avg_curr  = wCurr + eCurr + fbaCurr;
      r.fba_avg_prev    = fbaPrev;
      r.fba_avg_real    = fbaReal;
      r.fba_avg_curr    = fbaCurr;

      const w90 = Number(r.west_90d), w60 = Number(r.west_60d), w30 = Number(r.west_30d);
      const wPre = Number(r.west_30d_pre), w15 = Number(r.west_15d), w7 = Number(r.west_7d);
      const e90 = Number(r.east_90d), e60 = Number(r.east_60d), e30 = Number(r.east_30d);
      const ePre = Number(r.east_30d_pre), e15 = Number(r.east_15d), e7 = Number(r.east_7d);
      // west windows already exclude FBA at the SQL level
      r.west_fbm_30d = fbmThirtyDayAverage(w90, w60, w30, wPre, w15, w7, salesWindowWeights);
      r.east_fbm_30d = fbmThirtyDayAverage(e90, e60, e30, ePre, e15, e7, salesWindowWeights);
      r.total_30d    = (r.west_fbm_30d as number) + (r.east_fbm_30d as number) + (r.fba_30d as number);
    }

    await Promise.all([
      batchUpsert(primary, "shipcore.fc_stats",        linkRows,   salesCols, salesUpdateSet),
      batchUpsert(primary, "shipcore.fc_stats_custom", customRows, salesCols, salesUpdateSet),
    ]);

    // ── Step 3: Sync SWC SKUs from velocity snapshot → fc_products ──────────
    await primary.query(`
      INSERT INTO shipcore.fc_products
        (master_sku, product_name, category, category_code, status, sales_status,
         moq, order_multiple, cbm_per_unit, case_qty, weight_kg, created_at, updated_at)
      SELECT DISTINCT
        link_master_sku,
        link_master_sku,
        'Car Cover',
        'CC',
        'active'::shipcore.fc_product_status,
        'SWC',
        1, 1, 0.078, 1, 2.8,
        NOW(), NOW()
      FROM shipcore.fc_velocity_link_snapshot
      WHERE link_master_sku ILIKE '%SWC%'
        AND link_master_sku IS NOT NULL
      ON CONFLICT (master_sku) DO UPDATE SET
        category_code = 'CC',
        sales_status  = 'SWC',
        updated_at = NOW()
    `);

    await invalidatePlanningDashboardCache();

    return NextResponse.json({
      success: true,
      inventory_upserted: invRows.length,
      link_sales_upserted:   linkRows.length,
      custom_sales_upserted: customRows.length,
    });
  } catch (error) {
    console.error("Planning stats refresh POST failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
