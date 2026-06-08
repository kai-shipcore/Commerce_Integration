/**
 * Code Guide:
 * Sales trend endpoint for the home dashboard.
 * Queries ecommerce_data.sales_orders (same source as the Orders page) so
 * the home page numbers match what users see in /orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { CacheManager } from "@/lib/redis";

const CACHE_TTL = 5 * 60; // 5 minutes

function getErrorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startDate     = searchParams.get("startDate");
  const endDate       = searchParams.get("endDate");
  const prevStartDate = searchParams.get("prevStartDate");
  const prevEndDate   = searchParams.get("prevEndDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { success: false, error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  const cacheKey = `home:sales-trend:v2:${startDate}:${endDate}:${prevStartDate ?? ""}:${prevEndDate ?? ""}`;
  const cached = await CacheManager.get<unknown>(cacheKey);
  if (cached) {
    return NextResponse.json({ success: true, data: cached, cached: true });
  }

  try {
    const pool = getLookupPool();
    if (!pool) {
      return NextResponse.json(
        { success: false, error: "Lookup database unavailable" },
        { status: 503 },
      );
    }

    type TrendRow = { day: string; quantity: string; revenue: string };
    type TotalRow = { quantity: string; revenue: string };

    const [trendResult, totalResult, prevResult] = await Promise.all([
      pool.query<TrendRow>(`
        SELECT
          so.order_date::date::text                  AS day,
          COUNT(*)::text                             AS quantity,
          COALESCE(SUM(so.total_price), 0)::text     AS revenue
        FROM ecommerce_data.sales_orders so
        WHERE so.order_date >= $1::date
          AND so.order_date < ($2::date + INTERVAL '1 day')
        GROUP BY so.order_date::date
        ORDER BY so.order_date::date ASC
      `, [startDate, endDate]),

      pool.query<TotalRow>(`
        SELECT
          COUNT(*)::text                             AS quantity,
          COALESCE(SUM(so.total_price), 0)::text     AS revenue
        FROM ecommerce_data.sales_orders so
        WHERE so.order_date >= $1::date
          AND so.order_date < ($2::date + INTERVAL '1 day')
      `, [startDate, endDate]),

      prevStartDate && prevEndDate
        ? pool.query<TotalRow>(`
            SELECT COUNT(*)::text AS quantity
            FROM ecommerce_data.sales_orders so
            WHERE so.order_date >= $1::date
              AND so.order_date < ($2::date + INTERVAL '1 day')
          `, [prevStartDate, prevEndDate])
        : Promise.resolve(null),
    ]);

    const trend = trendResult.rows.map((r) => ({
      date:     r.day,
      quantity: parseInt(r.quantity, 10),
      revenue:  parseFloat(r.revenue),
    }));

    const totalQty     = parseInt(totalResult.rows[0]?.quantity ?? "0", 10);
    const totalRevenue = parseFloat(totalResult.rows[0]?.revenue  ?? "0");
    const prevQty      = prevResult ? parseInt(prevResult.rows[0]?.quantity ?? "0", 10) : null;

    const growthPct =
      prevQty !== null && prevQty > 0
        ? Math.round(((totalQty - prevQty) / prevQty) * 1000) / 10
        : null;

    const data = {
      trend,
      total:   { quantity: totalQty, revenue: totalRevenue },
      growthPct,
    };

    await CacheManager.set(cacheKey, data, CACHE_TTL);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(err) },
      { status: 500 },
    );
  }
}
