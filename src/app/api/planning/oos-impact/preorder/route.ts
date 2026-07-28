// GET /api/planning/oos-impact/preorder
// Shopify Pre-Order demand drop by SKU, channel, and OOS episode.
// The OOS episode supplies the comparison anchor; the custom velocity snapshot
// supplies normal/pre-order quantities. Missing sales dates are represented by
// the fixed window denominator, so a day without an order correctly counts as 0.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";
import { CacheManager } from "@/lib/redis";

const CACHE_KEY = "oos-preorder:sku-list:v4";
const CACHE_TTL_SECONDS = 10 * 60;
const MAX_WINDOW_DAYS = 30;
const DATA_LAG_DAYS = 2;
const SHOPIFY_CHANNELS = `'Coverland B2C','Coverland B2B','Icarcover'`;

export type PreorderDropSeverity = "good" | "warning" | "serious" | "critical";

export interface PreorderDropRow {
  id: string;
  sku: string;
  itemCategory: "Car Cover" | "Seat Cover" | "Floor Mat" | "SWC" | "Miscellaneous";
  channel: string;
  normalStart: string;
  normalEnd: string;
  preorderStart: string;
  preorderEnd: string;
  conversionDate: string;
  restockDate: string | null;
  windowDays: number;
  normalQty: number;
  preorderQty: number;
  normalDailyAverage: number;
  preorderDailyAverage: number;
  dropRate: number;
  severity: PreorderDropSeverity;
  stage: "active" | "ended";
}

function severityOf(dropRate: number): PreorderDropSeverity {
  if (dropRate < 20) return "good";
  if (dropRate < 40) return "warning";
  if (dropRate < 60) return "serious";
  return "critical";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const cached = await CacheManager.get<PreorderDropRow[]>(CACHE_KEY);
    if (cached) return NextResponse.json({ success: true, data: cached });

    const primary = getPrimaryPool();
    const result = await primary.query<{
      master_sku: string;
      item_category: PreorderDropRow["itemCategory"];
      channel: string;
      normal_start: string;
      normal_end: string;
      preorder_start: string;
      preorder_end: string;
      back_in_stock_on: string | null;
      window_days: number;
      normal_qty: string;
      preorder_qty: string;
      stage: PreorderDropRow["stage"];
    }>(`
      WITH episodes_raw AS (
        SELECT
          ${normalizedMasterSkuSql("master_sku")} AS master_sku,
          oos_started_on,
          back_in_stock_on,
          synced_at
        FROM shipcore.fc_inventory_history_snapshot
        WHERE oos_started_on < CURRENT_DATE - ${DATA_LAG_DAYS - 1}
      ),
      episodes_deduped AS (
        SELECT DISTINCT ON (master_sku, COALESCE(back_in_stock_on, DATE '9999-12-31'))
          master_sku,
          oos_started_on,
          back_in_stock_on
        FROM episodes_raw
        ORDER BY master_sku, COALESCE(back_in_stock_on, DATE '9999-12-31'), synced_at DESC
      ),
      episodes AS (
        SELECT
          master_sku,
          oos_started_on,
          back_in_stock_on,
          LEAST(
            ${MAX_WINDOW_DAYS},
            LEAST(COALESCE(back_in_stock_on, CURRENT_DATE - ${DATA_LAG_DAYS - 1}), CURRENT_DATE - ${DATA_LAG_DAYS - 1})
              - oos_started_on
          )::int AS window_days
        FROM episodes_deduped
      ),
      velocity AS (
        SELECT
          order_date,
          channel,
          item_category,
          order_type,
          ${normalizedMasterSkuSql("custom_master_sku")} AS master_sku,
          custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot
        WHERE channel IN (${SHOPIFY_CHANNELS})
      ),
      aggregated AS (
        SELECT
          e.master_sku,
          v.channel,
          COALESCE(
            MAX(v.item_category) FILTER (WHERE v.item_category IN ('Car Cover', 'Seat Cover', 'Floor Mat', 'SWC')),
            'Miscellaneous'
          ) AS item_category,
          e.oos_started_on,
          e.back_in_stock_on,
          e.window_days,
          COALESCE(SUM(v.qty) FILTER (
            WHERE v.order_date >= e.oos_started_on - e.window_days
              AND v.order_date < e.oos_started_on
              AND v.order_type IN ('sales', 'ttm')
          ), 0) AS normal_qty,
          COALESCE(SUM(v.qty) FILTER (
            WHERE v.order_date >= e.oos_started_on
              AND v.order_date < e.oos_started_on + e.window_days
              AND v.order_type IN ('preorder', 'ttm_preorder')
          ), 0) AS preorder_qty
        FROM episodes e
        JOIN velocity v
          ON v.master_sku = e.master_sku
         AND v.order_date >= e.oos_started_on - e.window_days
         AND v.order_date < e.oos_started_on + e.window_days
        WHERE e.window_days > 0
        GROUP BY e.master_sku, v.channel, e.oos_started_on, e.back_in_stock_on, e.window_days
      )
      SELECT
        master_sku,
        item_category,
        channel,
        (oos_started_on - window_days)::text AS normal_start,
        (oos_started_on - 1)::text AS normal_end,
        oos_started_on::text AS preorder_start,
        (oos_started_on + window_days - 1)::text AS preorder_end,
        back_in_stock_on::text AS back_in_stock_on,
        window_days,
        normal_qty::text,
        preorder_qty::text,
        CASE WHEN back_in_stock_on IS NULL THEN 'active' ELSE 'ended' END AS stage
      FROM aggregated
      WHERE normal_qty > 0
      ORDER BY oos_started_on DESC, master_sku, channel
    `);

    const data: PreorderDropRow[] = result.rows.map((row) => {
      const normalQty = Number(row.normal_qty);
      const preorderQty = Number(row.preorder_qty);
      const normalDailyAverage = normalQty / row.window_days;
      const preorderDailyAverage = preorderQty / row.window_days;
      // Keep negative values: a negative drop means sales increased after the
      // Pre-Order conversion and is an operational restock opportunity.
      const dropRate = Math.round(Math.min(100, ((normalDailyAverage - preorderDailyAverage) / normalDailyAverage) * 100));

      return {
        id: `${row.master_sku}|${row.channel}|${row.preorder_start}`,
        sku: row.master_sku,
        itemCategory: row.item_category,
        channel: row.channel,
        normalStart: row.normal_start,
        normalEnd: row.normal_end,
        preorderStart: row.preorder_start,
        preorderEnd: row.preorder_end,
        conversionDate: row.preorder_start,
        restockDate: row.back_in_stock_on,
        windowDays: row.window_days,
        normalQty,
        preorderQty,
        normalDailyAverage: Math.round(normalDailyAverage * 10_000) / 10_000,
        preorderDailyAverage: Math.round(preorderDailyAverage * 10_000) / 10_000,
        dropRate,
        severity: severityOf(dropRate),
        stage: row.stage,
      };
    });

    await CacheManager.set(CACHE_KEY, data, CACHE_TTL_SECONDS);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/preorder failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
