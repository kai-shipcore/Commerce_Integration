/**
 * Code Guide:
 * GET /api/velocity/channels — Returns distinct platform_source values from sc_sales_orders
 * used to populate Channel tab sub-tabs on the Velocity page.
 */

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const pool = getPrimaryPool();
    const [channelsRes, ebaySubRes] = await Promise.all([
      pool.query<{ platform_source: string }>(
        `SELECT DISTINCT platform_source::text AS platform_source
         FROM shipcore.sc_sales_orders
         WHERE platform_source IS NOT NULL
           AND order_date >= NOW() - INTERVAL '90 days'
         ORDER BY platform_source ASC`
      ),
      pool.query<{ fulfillment_channel: string }>(
        `SELECT DISTINCT fulfillment_channel::text AS fulfillment_channel
         FROM shipcore.sc_sales_orders
         WHERE platform_source = 'ebay'
           AND fulfillment_channel IS NOT NULL
           AND order_date >= NOW() - INTERVAL '90 days'
         ORDER BY fulfillment_channel ASC`
      ),
    ]);

    const subChannels: Record<string, string[]> = {};
    if (ebaySubRes.rows.length > 0) {
      subChannels["ebay"] = ebaySubRes.rows.map((r) => r.fulfillment_channel);
    }

    return NextResponse.json({
      success: true,
      channels: channelsRes.rows.map((r) => r.platform_source),
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
