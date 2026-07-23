// Code Guide: GET /api/planning/stats/oos-lost-demand-weights
// Read-only preview of the auto-computed OOS lost-demand weights that
// /api/planning/stats/refresh (Step 5) would use for any category/marketplace
// cell the user hasn't overridden — same ratio (marketplace 90d sales /
// Shopify 90d sales, from shipcore.fc_velocity_link_snapshot) computed live.
// Planning Settings fetches this to pre-fill the non-overridden input cells.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { OOS_LOST_DEMAND_CATEGORIES, OOS_LOST_DEMAND_MARKETPLACES, type CategoryKey } from "@/lib/planning/oos-lost-demand-weights";

const SHOPIFY_CHANNELS = `'Coverland B2C','Coverland B2B','Icarcover'`;
const AMAZON_CHANNELS  = `'Amazon FBA','Amazon FBM'`;
const EBAY_CHANNELS    = `'Auto_Armor','Advance_Parts'`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET() {
  try {
    const primary = getPrimaryPool();
    const result = await primary.query<{
      category_code: string;
      shopify_90d: string;
      amazon_90d: string;
      ebay_90d: string;
      walmart_90d: string;
    }>(`
      SELECT
        COALESCE(p.category_code, 'SC') AS category_code,
        SUM(CASE WHEN v.channel IN (${SHOPIFY_CHANNELS}) AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS shopify_90d,
        SUM(CASE WHEN v.channel IN (${AMAZON_CHANNELS})  AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS amazon_90d,
        SUM(CASE WHEN v.channel IN (${EBAY_CHANNELS})    AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS ebay_90d,
        SUM(CASE WHEN v.channel = 'Walmart'              AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS walmart_90d
      FROM shipcore.fc_velocity_link_snapshot v
      LEFT JOIN shipcore.fc_products p ON p.master_sku = v.link_master_sku
      GROUP BY COALESCE(p.category_code, 'SC')
    `);

    const byCategory = new Map(result.rows.map((r) => [r.category_code, r]));
    const weights = Object.fromEntries(
      OOS_LOST_DEMAND_CATEGORIES.map(({ key }) => {
        const row = byCategory.get(key);
        const shopify90d = Math.max(Number(row?.shopify_90d ?? 0), 1);
        const marketplaceWeights = Object.fromEntries(
          OOS_LOST_DEMAND_MARKETPLACES.map(({ key: marketplace }) => {
            const raw = row?.[`${marketplace}_90d` as "amazon_90d" | "ebay_90d" | "walmart_90d"] ?? "0";
            return [marketplace, Number(raw) / shopify90d];
          }),
        );
        return [key, marketplaceWeights];
      }),
    ) as Record<CategoryKey, Record<string, number>>;

    return NextResponse.json({ success: true, weights });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
