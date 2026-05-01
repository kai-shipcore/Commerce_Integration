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
    const { rows } = await pool.query<{ platform_source: string }>(
      `SELECT DISTINCT platform_source::text AS platform_source
       FROM shipcore.sc_sales_orders
       WHERE platform_source IS NOT NULL
         AND order_date >= NOW() - INTERVAL '90 days'
       ORDER BY platform_source ASC`
    );
    return NextResponse.json({
      success: true,
      channels: rows.map((r) => r.platform_source),
    });
  } catch (error) {
    console.error("[velocity/channels] GET error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
