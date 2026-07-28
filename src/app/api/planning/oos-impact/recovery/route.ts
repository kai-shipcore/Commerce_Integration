// Code Guide: GET /api/planning/oos-impact/recovery
// Real-data feed for the "타 채널 재입고 회복 추이" screen's SKU-comparison view.
// Base rows come from shipcore.fc_inventory_history_snapshot (OOS episodes with
// a resolved back_in_stock_on), joined to per-day per-channel qty to compute a
// pre-OOS baseline daily rate and a "days to recovery" outcome. Channel
// comparison (the line chart) is out of scope here and still uses sample data.
//
// The core metric is daysToRecovery, not a live/current sales snapshot — this
// screen's purpose is to find SKUs whose post-restock recovery was slow or
// never happened (biggest OOS damage), which is a question about the past
// trajectory, not "is this SKU selling well today." A trailing-14-day average
// (smooths day-to-day noise) is checked against 80% of baseline for each day
// after restock; the first day it crosses is daysToRecovery. Only sale-days
// need checking — the trailing average can only step upward via a new sale,
// never by an old day rolling out of the window, so no upward crossing is
// possible on a zero-sale day.
//
// IMPORTANT — velocity source: shipcore.fc_velocity_link_snapshot and
// fc_velocity_custom_snapshot are NOT complementary/additive subsets of sales —
// they're two near-duplicate copies of the same underlying data (confirmed:
// ~99% of SKUs appear in both with matching qty on matching dates), each
// feeding a separate parallel stats table (fc_stats vs fc_stats_custom, see
// dashboard/route.ts's statsSource selection). Summing both would silently
// double-count sales for almost every SKU. Exactly one source is picked per
// SKU by category, mirroring dashboard/route.ts's default (no explicit mode)
// branch: CC/FM/SWC → custom snapshot, everything else → link snapshot.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";
import { CacheManager } from "@/lib/redis";

const NON_SHOPIFY_CHANNELS = `'Amazon FBA','Amazon FBM','Walmart','Auto_Armor','Advance_Parts'`;

// "Already restocked" rows only start counting once at least this many days
// have passed — anything fresher is too noisy for a daily-average baseline.
const MIN_DAYS_SINCE_RESTOCK = 7;
// Smoothing window for the recovery-detection trailing average.
const ROLLING_WINDOW_DAYS = 14;
// A SKU counts as "recovered" once its trailing average reaches this share of
// its pre-OOS baseline (100% would be too strict — demand naturally drifts).
const RECOVERY_THRESHOLD_PCT = 0.8;
// How many days after restock we're willing to wait before calling a SKU
// "미회복" (never recovered) instead of "관찰중" (still within the window).
const RECOVERY_HORIZON_DAYS = 90;

export type RecoverySeverity = "good" | "warning" | "serious" | "critical";

export interface RecoveryRow {
  sku: string;
  channel: string;
  oosStartedOn: string;
  restockDate: string;
  oosDays: number;
  daysSinceRestock: number;
  baseline: number;
  // Non-overlapping post-restock windows (daily avg qty, not a %) — supporting
  // context for the recovery trajectory shape, not the headline metric.
  day0to30: number | null;
  day30to60: number | null;
  day60to90: number | null;
  // Days from restock until the trailing-14-day average first reached
  // RECOVERY_THRESHOLD_PCT of baseline. Null if not yet reached.
  daysToRecovery: number | null;
  severity: RecoverySeverity;
  label: string;
}

function severityOf(daysToRecovery: number | null, daysSinceRestock: number): { severity: RecoverySeverity; label: string } {
  if (daysToRecovery !== null && daysToRecovery <= 30) return { severity: "good", label: "정상 회복" };
  if (daysToRecovery !== null) return { severity: "warning", label: "느린 회복" };
  if (daysSinceRestock < RECOVERY_HORIZON_DAYS) return { severity: "serious", label: "관찰중" };
  return { severity: "critical", label: "미회복" };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const CACHE_KEY = "oos-recovery:sku-list:v3";
const CACHE_TTL_SECONDS = 600;

export async function GET() {
  try {
    const cached = await CacheManager.get<RecoveryRow[]>(CACHE_KEY);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    const primary = getPrimaryPool();
    const result = await primary.query<{
      master_sku: string;
      channel: string;
      oos_started_on: string;
      oos_days: number;
      back_in_stock_on: string;
      days_since_restock: number;
      baseline: string;
      day0_30_avg: string | null;
      day30_60_avg: string | null;
      day60_90_avg: string | null;
      days_to_recovery: number | null;
    }>(`
      WITH episodes_raw AS (
        -- Re-running /api/planning/stats/refresh can shift oos_started_on by a
        -- day or two for the same real restock if the upstream inventory-history
        -- view gets corrected between syncs. Since its upsert keys on
        -- (master_sku, oos_started_on), a shifted date inserts a new row instead
        -- of replacing the old one, leaving stale duplicate episodes behind for
        -- the same (master_sku, back_in_stock_on) — keep only the most recently
        -- synced detection per restock so downstream rows stay unique.
        SELECT
          ${normalizedMasterSkuSql("master_sku")} AS master_sku,
          oos_started_on,
          back_in_stock_on,
          synced_at
        FROM shipcore.fc_inventory_history_snapshot
        WHERE back_in_stock_on IS NOT NULL
          AND CURRENT_DATE - back_in_stock_on >= ${MIN_DAYS_SINCE_RESTOCK}
      ),
      episodes AS (
        SELECT DISTINCT ON (master_sku, back_in_stock_on)
          master_sku,
          oos_started_on,
          back_in_stock_on,
          (back_in_stock_on - oos_started_on)::int AS oos_days,
          (CURRENT_DATE - back_in_stock_on)::int AS days_since_restock
        FROM episodes_raw
        ORDER BY master_sku, back_in_stock_on, synced_at DESC
      ),
      velocity AS (
        SELECT v.order_date, v.channel, v.link_master_sku AS master_sku, v.link_qty AS qty
        FROM shipcore.fc_velocity_link_snapshot v
        WHERE v.channel IN (${NON_SHOPIFY_CHANNELS})
          AND NOT EXISTS (
            SELECT 1 FROM shipcore.fc_products p
            WHERE p.master_sku = v.link_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
          )
        UNION ALL
        SELECT v.order_date, v.channel, v.custom_master_sku AS master_sku, v.custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot v
        WHERE v.channel IN (${NON_SHOPIFY_CHANNELS})
          AND EXISTS (
            SELECT 1 FROM shipcore.fc_products p
            WHERE p.master_sku = v.custom_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
          )
      ),
      -- Trailing 14-calendar-day average as of each sale-day. RANGE (not ROWS)
      -- is essential: velocity rows only exist for days with a sale, so a ROWS
      -- frame would average "the preceding 14 sale-days" (spanning however many
      -- calendar days that takes for a slow SKU) instead of a true 14-day window.
      daily_rolling AS (
        SELECT master_sku, channel, order_date,
          SUM(qty) OVER (
            PARTITION BY master_sku, channel ORDER BY order_date
            RANGE BETWEEN INTERVAL '${ROLLING_WINDOW_DAYS - 1} days' PRECEDING AND CURRENT ROW
          ) / ${ROLLING_WINDOW_DAYS}.0 AS trailing_avg
        FROM velocity
      ),
      joined AS (
        SELECT e.master_sku, e.oos_started_on, e.back_in_stock_on, e.oos_days, e.days_since_restock,
               v.channel, v.order_date, v.qty
        FROM episodes e
        JOIN velocity v
          ON v.master_sku = e.master_sku
         AND v.order_date >= e.oos_started_on - 30
         AND v.order_date < e.back_in_stock_on + ${RECOVERY_HORIZON_DAYS}
      ),
      agg AS (
        SELECT
          master_sku, channel, oos_started_on, oos_days, back_in_stock_on, days_since_restock,
          COALESCE(SUM(qty) FILTER (
            WHERE order_date >= oos_started_on - 30 AND order_date < oos_started_on
          ), 0) / 30.0 AS baseline,
          -- Non-overlapping windows (0–30 / 30–60 / 60–90d since restock) — the
          -- table shows these as absolute daily averages, not %, so each 30-day
          -- block is comparable on its own instead of being diluted by everything
          -- before it.
          CASE WHEN days_since_restock >= 30 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on AND order_date < back_in_stock_on + 30), 0) / 30.0
          END AS day0_30_avg,
          CASE WHEN days_since_restock >= 60 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on + 30 AND order_date < back_in_stock_on + 60), 0) / 30.0
          END AS day30_60_avg,
          CASE WHEN days_since_restock >= 90 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on + 60 AND order_date < back_in_stock_on + 90), 0) / 30.0
          END AS day60_90_avg
        FROM joined
        GROUP BY master_sku, channel, oos_started_on, oos_days, back_in_stock_on, days_since_restock
      ),
      recovery AS (
        -- order_date >= back_in_stock_on + (window-1) ensures the 14-day
        -- trailing frame [order_date-13, order_date] never reaches before the
        -- restock date — otherwise, for short OOS episodes, the window at low
        -- day-offsets would still include ordinary pre-stockout sales, letting
        -- "recovery" trigger from demand that has nothing to do with the
        -- restock at all. This puts a floor of ROLLING_WINDOW_DAYS-1 days on
        -- the earliest possible daysToRecovery.
        SELECT a.master_sku, a.channel, a.back_in_stock_on,
          MIN(dr.order_date) AS first_recovered_on
        FROM agg a
        JOIN daily_rolling dr
          ON dr.master_sku = a.master_sku
         AND dr.channel = a.channel
         AND dr.order_date >= a.back_in_stock_on + ${ROLLING_WINDOW_DAYS - 1}
         AND dr.order_date <= a.back_in_stock_on + ${RECOVERY_HORIZON_DAYS}
         AND dr.trailing_avg >= ${RECOVERY_THRESHOLD_PCT} * a.baseline
        WHERE a.baseline > 0
        GROUP BY a.master_sku, a.channel, a.back_in_stock_on
      )
      SELECT
        a.master_sku, a.channel,
        a.oos_started_on::text AS oos_started_on,
        a.oos_days,
        a.back_in_stock_on::text AS back_in_stock_on,
        a.days_since_restock,
        a.baseline::text AS baseline,
        a.day0_30_avg::text AS day0_30_avg,
        a.day30_60_avg::text AS day30_60_avg,
        a.day60_90_avg::text AS day60_90_avg,
        (r.first_recovered_on - a.back_in_stock_on)::int AS days_to_recovery
      FROM agg a
      LEFT JOIN recovery r
        ON r.master_sku = a.master_sku AND r.channel = a.channel AND r.back_in_stock_on = a.back_in_stock_on
      WHERE a.baseline > 0
      ORDER BY a.days_since_restock ASC
    `);

    const round1 = (avg: string | null) => (avg === null ? null : Math.round(Number(avg) * 10) / 10);

    const data: RecoveryRow[] = result.rows.map((r) => {
      const baseline = Number(r.baseline);
      const { severity, label } = severityOf(r.days_to_recovery, r.days_since_restock);

      return {
        sku: r.master_sku,
        channel: r.channel,
        oosStartedOn: r.oos_started_on,
        restockDate: r.back_in_stock_on,
        oosDays: r.oos_days,
        daysSinceRestock: r.days_since_restock,
        baseline: Math.round(baseline * 10) / 10,
        day0to30: round1(r.day0_30_avg),
        day30to60: round1(r.day30_60_avg),
        day60to90: round1(r.day60_90_avg),
        daysToRecovery: r.days_to_recovery,
        severity,
        label,
      };
    });

    await CacheManager.set(CACHE_KEY, data, CACHE_TTL_SECONDS);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/recovery failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
