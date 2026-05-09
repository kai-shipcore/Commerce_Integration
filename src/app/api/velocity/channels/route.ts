/**
 * Code Guide:
 * GET /api/velocity/channels — Returns distinct platform_source values from ecommerce_data
 * used to populate Channel tab sub-tabs on the Velocity page.
 */

import { NextResponse } from "next/server";
import { getLookupPool } from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const pool = getLookupPool();

    if (!pool) {
      throw new Error("No lookup database connection configured");
    }

    const [channelsRes, ebaySubRes] = await Promise.all([
      pool.query<{ platform_source: string }>(
        `SELECT DISTINCT platform_source::text AS platform_source
         FROM ecommerce_data.vw_sales_order_items
         WHERE platform_source IS NOT NULL
           AND order_date >= NOW() - INTERVAL '90 days'
           AND master_sku IS NOT NULL
           AND quantity > 0
           AND item_status IN ('FULFILLED', 'Shipped')
         ORDER BY platform_source ASC`
      ),
      pool.query<{ fulfillment_channel: string }>(
        `SELECT DISTINCT fulfillment_channel::text AS fulfillment_channel
         FROM ecommerce_data.vw_sales_order_items
         WHERE platform_source::text = 'ebay'
           AND fulfillment_channel IS NOT NULL
           AND order_date >= NOW() - INTERVAL '90 days'
           AND master_sku IS NOT NULL
           AND quantity > 0
           AND item_status IN ('FULFILLED', 'Shipped')
         ORDER BY fulfillment_channel ASC`
      ),
    ]);

    const subChannels: Record<string, string[]> = {};
    if (ebaySubRes.rows.length > 0) {
      subChannels["ebay"] = ebaySubRes.rows.map((r: { fulfillment_channel: string }) => r.fulfillment_channel);
    }

    return NextResponse.json({
      success: true,
      channels: channelsRes.rows.map((r: { platform_source: string }) => r.platform_source),
      subChannels,
    });
  } catch (error) {
    console.error("[velocity/channels] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
