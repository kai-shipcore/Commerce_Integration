// Code Guide: GET /api/planning/oos-impact/recovery/drilldown?sku=&channel=&restockDate=
// Per-SKU×channel daily-quantity series for the recovery-screen.tsx drilldown
// chart. Returns 7 points aligned to the fixed x-axis anchors the chart already
// uses: [-30,-15,0,15,30,60,90] (days relative to restock). The two pre-restock
// points are windowed against oos_started_on (before the OOS episode began,
// since qty during the episode itself is ~0 by definition); day 0 is the
// restock marker itself and is always reported as 0. restockDate disambiguates
// a SKU×channel pair that has gone OOS→restocked more than once.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");
    const channel = searchParams.get("channel");
    const restockDate = searchParams.get("restockDate");

    if (!sku || !channel) {
      return NextResponse.json({ success: false, error: "sku and channel are required" }, { status: 400 });
    }

    const primary = getPrimaryPool();

    const episodeResult = await primary.query<{ oos_started_on: string; back_in_stock_on: string }>(
      `SELECT oos_started_on::text, back_in_stock_on::text
       FROM shipcore.fc_inventory_history_snapshot
       WHERE ${normalizedMasterSkuSql("master_sku")} = $1
         AND back_in_stock_on IS NOT NULL
         ${restockDate ? "AND back_in_stock_on = $2::date" : ""}
       ORDER BY back_in_stock_on DESC
       LIMIT 1`,
      restockDate ? [sku, restockDate] : [sku],
    );

    const episode = episodeResult.rows[0];
    if (!episode) {
      return NextResponse.json({ success: false, error: "No resolved OOS episode found for this SKU" }, { status: 404 });
    }

    const seriesResult = await primary.query<{
      pre1: string; pre2: string; baseline: string; d15: string; d30: string; d60: string; d90: string;
    }>(
      `WITH velocity AS (
         SELECT order_date, link_qty AS qty FROM shipcore.fc_velocity_link_snapshot
         WHERE link_master_sku = $1 AND channel = $2
         UNION ALL
         SELECT order_date, custom_qty AS qty FROM shipcore.fc_velocity_custom_snapshot
         WHERE custom_master_sku = $1 AND channel = $2
       )
       SELECT
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $3::date - 30 AND order_date < $3::date - 15), 0) / 15.0 AS pre1,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $3::date - 15 AND order_date < $3::date), 0) / 15.0 AS pre2,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $3::date - 30 AND order_date < $3::date), 0) / 30.0 AS baseline,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 15), 0) / 15.0 AS d15,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 30), 0) / 30.0 AS d30,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 60), 0) / 60.0 AS d60,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 90), 0) / 90.0 AS d90
       FROM velocity`,
      [sku, channel, episode.oos_started_on, episode.back_in_stock_on],
    );

    const s = seriesResult.rows[0];
    const round1 = (v: string) => Math.round(Number(v) * 10) / 10;

    return NextResponse.json({
      success: true,
      data: {
        points: [round1(s.pre1), round1(s.pre2), 0, round1(s.d15), round1(s.d30), round1(s.d60), round1(s.d90)],
        baseline: round1(s.baseline),
        restockDate: episode.back_in_stock_on,
      },
    });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/recovery/drilldown failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
