// Code Guide: GET /api/planning/oos-impact/recovery
// Real-data feed for the "타 채널 재입고 회복 추이" screen's SKU-comparison view.
// Base rows come from shipcore.fc_inventory_history_snapshot (OOS episodes with
// a resolved back_in_stock_on), joined to shipcore.fc_velocity_link_snapshot /
// fc_velocity_custom_snapshot (per-day per-channel qty) to compute a pre-OOS
// baseline daily rate and post-restock recovery rates. Channel comparison
// (the line chart) is out of scope here and still uses sample data.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";
import { CacheManager } from "@/lib/redis";

const NON_SHOPIFY_CHANNELS = `'Amazon FBA','Amazon FBM','Walmart','Auto_Armor','Advance_Parts'`;

// "Already restocked" rows only start counting once at least this many days
// have passed — anything fresher is too noisy for a daily-average recovery rate.
const MIN_DAYS_SINCE_RESTOCK = 7;
// "Current recovery" = trailing daily average up to 2 days ago (data-completeness
// lag, same convention used throughout stats/refresh/route.ts), capped at 14 days.
const CURRENT_WINDOW_DAYS = 14;
const DATA_LAG_DAYS = 2;

export type RecoverySeverity = "good" | "warning" | "critical";

export interface RecoveryRow {
  sku: string;
  channel: string;
  oosDays: number;
  restockDate: string;
  daysSinceRestock: number;
  baseline: number;
  currentRecovery: number;
  r30: number | null;
  r60: number | null;
  r90: number | null;
  severity: RecoverySeverity;
  label: string;
}

function severityOf(currentRecovery: number): { severity: RecoverySeverity; label: string } {
  if (currentRecovery >= 85) return { severity: "good", label: "정상화" };
  if (currentRecovery >= 50) return { severity: "warning", label: "회복 후반" };
  return { severity: "critical", label: "회복 초기" };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const CACHE_KEY = "oos-recovery:sku-list";
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
      oos_days: number;
      back_in_stock_on: string;
      days_since_restock: number;
      baseline: string;
      current_avg: string;
      r30_avg: string | null;
      r60_avg: string | null;
      r90_avg: string | null;
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
        SELECT order_date, channel, link_master_sku AS master_sku, link_qty AS qty
        FROM shipcore.fc_velocity_link_snapshot
        WHERE channel IN (${NON_SHOPIFY_CHANNELS})
        UNION ALL
        SELECT order_date, channel, custom_master_sku AS master_sku, custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot
        WHERE channel IN (${NON_SHOPIFY_CHANNELS})
      ),
      joined AS (
        SELECT e.master_sku, e.oos_started_on, e.back_in_stock_on, e.oos_days, e.days_since_restock,
               v.channel, v.order_date, v.qty
        FROM episodes e
        JOIN velocity v
          ON v.master_sku = e.master_sku
         AND v.order_date >= e.oos_started_on - 30
         AND v.order_date < e.back_in_stock_on + 90
      ),
      agg AS (
        SELECT
          master_sku, channel, oos_days, back_in_stock_on, days_since_restock,
          COALESCE(SUM(qty) FILTER (
            WHERE order_date >= oos_started_on - 30 AND order_date < oos_started_on
          ), 0) / 30.0 AS baseline,
          COALESCE(SUM(qty) FILTER (
            WHERE order_date > GREATEST(back_in_stock_on - 1, CURRENT_DATE - ${DATA_LAG_DAYS} - ${CURRENT_WINDOW_DAYS})
              AND order_date <= CURRENT_DATE - ${DATA_LAG_DAYS}
          ), 0) / GREATEST(1, CURRENT_DATE - ${DATA_LAG_DAYS} - GREATEST(back_in_stock_on - 1, CURRENT_DATE - ${DATA_LAG_DAYS} - ${CURRENT_WINDOW_DAYS}))::numeric AS current_avg,
          CASE WHEN days_since_restock >= 30 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on AND order_date < back_in_stock_on + 30), 0) / 30.0
          END AS r30_avg,
          CASE WHEN days_since_restock >= 60 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on AND order_date < back_in_stock_on + 60), 0) / 60.0
          END AS r60_avg,
          CASE WHEN days_since_restock >= 90 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on AND order_date < back_in_stock_on + 90), 0) / 90.0
          END AS r90_avg
        FROM joined
        GROUP BY master_sku, channel, oos_days, back_in_stock_on, days_since_restock
      )
      SELECT
        master_sku, channel, oos_days,
        back_in_stock_on::text AS back_in_stock_on,
        days_since_restock,
        baseline::text AS baseline,
        current_avg::text AS current_avg,
        r30_avg::text AS r30_avg,
        r60_avg::text AS r60_avg,
        r90_avg::text AS r90_avg
      FROM agg
      WHERE baseline > 0
      ORDER BY days_since_restock ASC
    `);

    const data: RecoveryRow[] = result.rows.map((r) => {
      const baseline = Number(r.baseline);
      const currentAvg = Number(r.current_avg);
      const currentRecovery = Math.round((currentAvg / baseline) * 100);
      const toPct = (avg: string | null) => (avg === null ? null : Math.round((Number(avg) / baseline) * 100));
      const { severity, label } = severityOf(currentRecovery);

      return {
        sku: r.master_sku,
        channel: r.channel,
        oosDays: r.oos_days,
        restockDate: r.back_in_stock_on,
        daysSinceRestock: r.days_since_restock,
        baseline: Math.round(baseline * 10) / 10,
        currentRecovery,
        r30: toPct(r.r30_avg),
        r60: toPct(r.r60_avg),
        r90: toPct(r.r90_avg),
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
