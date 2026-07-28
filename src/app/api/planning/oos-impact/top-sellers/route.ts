// Code Guide: GET /api/planning/oos-impact/top-sellers
// Top 100 SKUs by trailing-30-day sales quantity, aggregated at the Master SKU
// level across ALL channels (Shopify included) — unrelated to OOS/restock
// history. Companion reference view to the recovery screen's "채널 비교"/
// "스큐 비교" toggle, for "what are our current best sellers" context.
//
// IMPORTANT — velocity source: shipcore.fc_velocity_link_snapshot and
// fc_velocity_custom_snapshot are two near-duplicate copies of the same sales
// data, not additive (see recovery/route.ts for the full explanation).
// Exactly one source is picked per SKU by category, same rule as
// dashboard/route.ts's default branch: CC/FM/SWC → custom snapshot, everything
// else → link snapshot. Unlike recovery/route.ts, no channel filter is applied
// here — ranking is per Master SKU across every channel, Shopify included.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { CacheManager } from "@/lib/redis";

const WINDOW_DAYS = 30;
const LIMIT = 100;

export interface TopSellerRow {
  rank: number;
  sku: string;
  categoryCode: string | null;
  totalQty: number;
  avgDaily: number;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const CACHE_KEY = "oos-top-sellers:sku-list:v1";
const CACHE_TTL_SECONDS = 600;

export async function GET() {
  try {
    const cached = await CacheManager.get<TopSellerRow[]>(CACHE_KEY);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    const primary = getPrimaryPool();
    const result = await primary.query<{
      master_sku: string;
      category_code: string | null;
      total_qty: string;
    }>(`
      WITH velocity AS (
        SELECT v.order_date, v.link_master_sku AS master_sku, v.link_qty AS qty
        FROM shipcore.fc_velocity_link_snapshot v
        WHERE NOT EXISTS (
          SELECT 1 FROM shipcore.fc_products p
          WHERE p.master_sku = v.link_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
        )
        UNION ALL
        SELECT v.order_date, v.custom_master_sku AS master_sku, v.custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot v
        WHERE EXISTS (
          SELECT 1 FROM shipcore.fc_products p
          WHERE p.master_sku = v.custom_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
        )
      )
      SELECT
        v.master_sku,
        MAX(p.category_code) AS category_code,
        SUM(v.qty)::text AS total_qty
      FROM velocity v
      LEFT JOIN shipcore.fc_products p ON p.master_sku = v.master_sku
      WHERE v.order_date >= CURRENT_DATE - ${WINDOW_DAYS}
      GROUP BY v.master_sku
      HAVING SUM(v.qty) > 0
      ORDER BY SUM(v.qty) DESC
      LIMIT ${LIMIT}
    `);

    const data: TopSellerRow[] = result.rows.map((r, i) => {
      const totalQty = Number(r.total_qty);
      return {
        rank: i + 1,
        sku: r.master_sku,
        categoryCode: r.category_code,
        totalQty,
        avgDaily: Math.round((totalQty / WINDOW_DAYS) * 10) / 10,
      };
    });

    await CacheManager.set(CACHE_KEY, data, CACHE_TTL_SECONDS);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/top-sellers failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
