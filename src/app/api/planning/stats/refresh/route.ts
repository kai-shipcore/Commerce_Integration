// Code Guide: POST /api/planning/stats/refresh — Phase 2 stats refresh.
// Step 1: inventory — reads ecommerce_data.coverland_inventory (lookup pool) and upserts
//         west_stock, east_stock, total_stock, back into shipcore.fc_stats.
//         Warehouse mapping: 'Fullerton' → west, 'TTM Group' → east.
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
import {
  currentDailyAverage,
  fbmThirtyDayAverage,
  forecastCategoryCodeForSku,
} from "@/lib/planning/forecast-calculations";

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

export async function POST() {
  try {
    const lookup  = getLookupPool();
    const primary = getPrimaryPool();

    if (!lookup) {
      return NextResponse.json(
        { success: false, error: "No database connection available" },
        { status: 500 },
      );
    }

    // ── Step 1: Inventory from coverland_inventory ───────────────────────────
    const invResult = await lookup.query<{
      master_sku:  string;
      west_stock:  number;
      east_stock:  number;
      total_stock: number;
      back:        number;
    }>(`
      SELECT
        BTRIM(master_sku)                                                              AS master_sku,
        SUM(CASE WHEN warehouse = 'Fullerton' THEN COALESCE(on_hand, 0) ELSE 0 END)::int AS west_stock,
        SUM(CASE WHEN warehouse = 'TTM Group' THEN COALESCE(on_hand, 0) ELSE 0 END)::int AS east_stock,
        SUM(COALESCE(on_hand,   0))::int                                               AS total_stock,
        -SUM(COALESCE(backorder, 0))::int                                              AS back
      FROM ecommerce_data.coverland_inventory
      WHERE master_sku IS NOT NULL AND BTRIM(master_sku) <> ''
      GROUP BY BTRIM(master_sku)
    `);

    const invRows = invResult.rows as Record<string, unknown>[];
    const invCols = ["master_sku", "west_stock", "east_stock", "total_stock", "back"];
    const invUpdate = `west_stock    = EXCLUDED.west_stock,
       east_stock    = EXCLUDED.east_stock,
       total_stock   = EXCLUDED.total_stock,
       back          = EXCLUDED.back,
       calculated_at = NOW(),
       updated_at    = NOW()`;
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
      fba_avg_real   = 0, fba_avg_curr   = 0, fba_30d   = 0,
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
        (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        ) AS avg_daily_real,
        -- avg_daily_prev (west, FBA excluded): same formula, windows shifted back 7 days
        (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.10
        ) AS avg_daily_prev,
        -- east_avg_real (ttm): same weighted formula using ttm orders + preorder
        (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15
        ) AS east_avg_real,
        -- east_avg_prev (ttm): shifted back 7 days
        (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 7  * 0.15
        ) AS east_avg_prev,
        -- fba_avg_real: FBA 30D / 30 (simple daily average, matches Google Sheet)
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN link_qty ELSE 0 END)::numeric / 30 AS fba_avg_real,
        -- fba_avg_prev: FBA 30D (prev window, shifted 7 days back) / 30
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN link_qty ELSE 0 END)::numeric / 30 AS fba_avg_prev,
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
        (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        ) AS avg_daily_real,
        (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.10
        ) AS avg_daily_prev,
        (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 91 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 61 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 16 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 8  AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15
        ) AS east_avg_real,
        (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 98 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 68 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 23 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= CURRENT_DATE - 15 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 7  * 0.15
        ) AS east_avg_prev,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 31 AND order_date <= CURRENT_DATE - 2 THEN custom_qty ELSE 0 END)::numeric / 30 AS fba_avg_real,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= CURRENT_DATE - 38 AND order_date <= CURRENT_DATE - 9 THEN custom_qty ELSE 0 END)::numeric / 30 AS fba_avg_prev,
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
      "fba_avg_real",   "fba_avg_curr",   "fba_30d",
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
      const fbaReal = Number(r.fba_avg_real ?? 0);
      const wCurr   = currentDailyAverage(wPrev, wReal, categoryCode);
      const eCurr   = currentDailyAverage(ePrev, eReal, categoryCode);
      const fbaCurr = fbaReal; // FBA 현재 = FBA 실제 (no blending, matches Google Sheet)

      r.avg_daily_prev  = wPrev;
      r.avg_daily_real  = wReal;
      r.east_avg_prev   = ePrev;
      r.east_avg_real   = eReal;
      r.avg_daily_curr  = wCurr;
      r.east_avg_curr   = eCurr;
      r.total_avg_prev  = wPrev + ePrev;
      r.total_avg_real  = wReal + eReal + fbaReal;
      r.total_avg_curr  = wCurr + eCurr + fbaCurr;
      r.fba_avg_real    = fbaReal;
      r.fba_avg_curr    = fbaCurr;

      const w90 = Number(r.west_90d), w60 = Number(r.west_60d), w30 = Number(r.west_30d);
      const wPre = Number(r.west_30d_pre), w15 = Number(r.west_15d), w7 = Number(r.west_7d);
      const e90 = Number(r.east_90d), e60 = Number(r.east_60d), e30 = Number(r.east_30d);
      const ePre = Number(r.east_30d_pre), e15 = Number(r.east_15d), e7 = Number(r.east_7d);
      // west windows already exclude FBA at the SQL level
      r.west_fbm_30d = fbmThirtyDayAverage(w90, w60, w30, wPre, w15, w7);
      r.east_fbm_30d = fbmThirtyDayAverage(e90, e60, e30, ePre, e15, e7);
      r.total_30d    = (r.west_fbm_30d as number) + (r.east_fbm_30d as number) + (r.fba_30d as number);
    }

    await Promise.all([
      batchUpsert(primary, "shipcore.fc_stats",        linkRows,   salesCols, salesUpdateSet),
      batchUpsert(primary, "shipcore.fc_stats_custom", customRows, salesCols, salesUpdateSet),
    ]);
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
