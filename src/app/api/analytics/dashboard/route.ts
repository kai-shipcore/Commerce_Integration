/**
 * Code Guide:
 * This API route owns the analytics / dashboard backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { listActivePlatformIntegrations } from "@/lib/db/platform-integrations";
import { CacheManager } from "@/lib/redis";

const DASHBOARD_CACHE_KEY = "dashboard:analytics";
const DASHBOARD_CACHE_TTL = 5 * 60; // 5 minutes

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// GET /api/analytics/dashboard - Get dashboard statistics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30d";
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    // Calculate date range based on period or custom dates
    const now = new Date();
    let periodStartDate: Date;
    let periodEndDate: Date = now;
    let cacheKey: string;

    if (startDateParam && endDateParam) {
      // Custom date range
      periodStartDate = new Date(startDateParam);
      periodEndDate = new Date(endDateParam);
      // Set end date to end of day
      periodEndDate.setHours(23, 59, 59, 999);
      cacheKey = `${DASHBOARD_CACHE_KEY}:${startDateParam}:${endDateParam}`;
    } else {
      // Preset period
      switch (period) {
        case "7d":
          periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "90d":
          periodStartDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case "1y":
          periodStartDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case "ytd":
          periodStartDate = new Date(now.getFullYear(), 0, 1); // January 1st of current year
          break;
        case "all":
          periodStartDate = new Date(2000, 0, 1); // Far back date to get all records
          break;
        default:
          periodStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      cacheKey = `${DASHBOARD_CACHE_KEY}:${period}`;
    }

    const cached = await CacheManager.get<unknown>(cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        data: cached,
        cached: true,
      });
    }
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // The dashboard is mostly aggregation work, so parallel reads keep the
    // endpoint responsive without changing behavior.
    const [
      totalSKUs,
      totalCollections,
      totalActiveIntegrations,
      lowStockSKUs,
    ] = await Promise.all([
      // Total SKUs
      prisma.sKU.count(),

      // Total Collections
      prisma.sKUCollection.count(),

      listActivePlatformIntegrations()
        .then((integrations) => integrations.length)
        .catch((error) => {
          console.warn(
            "Dashboard integrations lookup failed, falling back to 0:",
            getErrorMessage(error)
          );
          return 0;
        }),

      // Low stock SKUs (below reorder point)
      prisma.sKU.findMany({
        where: {
          AND: [
            { reorderPoint: { not: null } },
            {
              currentStock: {
                lte: prisma.sKU.fields.reorderPoint,
              },
            },
          ],
        },
        select: {
          id: true,
          skuCode: true,
          name: true,
          currentStock: true,
          reorderPoint: true,
        },
        take: 10,
      }),

    ]);

    const pool = getPrimaryPool();

    type SalesAgg = { qty: string; revenue: string; cnt: string };
    type TopSkuRow = { master_sku: string; qty: string; revenue: string; cnt: string };
    type DayRow = { day: string; qty: string; revenue: string };
    type RecentRow = { master_sku: string; channel_sku: string; platform_source: string; order_date: string; quantity: string };

    const [sales30, sales7, topSkuRows, recentRows, trendRows] = await Promise.all([
      pool.query<SalesAgg>(
        `SELECT COALESCE(SUM(i.quantity),0)::text AS qty,
                COALESCE(SUM(i.line_total),0)::text AS revenue,
                COUNT(*)::text AS cnt
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE o.order_date >= $1 AND i.is_counted_in_demand = true`, [thirtyDaysAgo]),

      pool.query<SalesAgg>(
        `SELECT COALESCE(SUM(i.quantity),0)::text AS qty,
                COALESCE(SUM(i.line_total),0)::text AS revenue,
                COUNT(*)::text AS cnt
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE o.order_date >= $1 AND i.is_counted_in_demand = true`, [sevenDaysAgo]),

      pool.query<TopSkuRow>(
        `SELECT i.master_sku,
                COALESCE(SUM(i.quantity),0)::text AS qty,
                COALESCE(SUM(i.line_total),0)::text AS revenue,
                COUNT(*)::text AS cnt
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE o.order_date >= $1 AND o.order_date <= $2
           AND i.is_counted_in_demand = true AND i.master_sku IS NOT NULL
         GROUP BY i.master_sku
         ORDER BY SUM(i.quantity) DESC
         LIMIT 10`, [periodStartDate, periodEndDate]),

      pool.query<RecentRow>(
        `SELECT i.master_sku, i.channel_sku, o.platform_source::text, o.order_date::text, i.quantity::text
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         ORDER BY o.created_at DESC LIMIT 10`),

      pool.query<DayRow>(
        `SELECT o.order_date::date::text AS day,
                COALESCE(SUM(i.quantity),0)::text AS qty,
                COALESCE(SUM(i.line_total),0)::text AS revenue
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE o.order_date >= $1 AND o.order_date <= $2 AND i.is_counted_in_demand = true
         GROUP BY o.order_date::date
         ORDER BY o.order_date::date ASC`, [periodStartDate, periodEndDate]),
    ]);

    const salesLast30Days = sales30.rows[0];
    const salesLast7Days = sales7.rows[0];

    const topSelling = topSkuRows.rows.map((row) => ({
      sku: { skuCode: row.master_sku, name: row.master_sku },
      totalQuantity: parseInt(row.qty, 10),
      totalRevenue: parseFloat(row.revenue),
      orderCount: parseInt(row.cnt, 10),
    }));

    const avg30Days = parseInt(salesLast30Days.qty, 10) / 30;
    const avg7Days = parseInt(salesLast7Days.qty, 10) / 7;
    const growthPercentage = avg30Days > 0 ? ((avg7Days - avg30Days) / avg30Days) * 100 : 0;

    const salesTrend = trendRows.rows.map((r) => ({
      date: r.day,
      quantity: parseInt(r.qty, 10),
      revenue: parseFloat(r.revenue),
    }));

    const response = {
      overview: {
        totalSKUs,
        totalCollections,
        totalActiveIntegrations,
        lowStockCount: lowStockSKUs.length,
      },
      sales: {
        last30Days: {
          totalQuantity: parseInt(salesLast30Days.qty, 10),
          totalRevenue: parseFloat(salesLast30Days.revenue),
          orderCount: parseInt(salesLast30Days.cnt, 10),
        },
        last7Days: {
          totalQuantity: parseInt(salesLast7Days.qty, 10),
          totalRevenue: parseFloat(salesLast7Days.revenue),
          orderCount: parseInt(salesLast7Days.cnt, 10),
        },
        growthPercentage: Math.round(growthPercentage * 10) / 10,
        trend: salesTrend,
      },
      topSelling,
      lowStockSKUs,
      recentActivity: recentRows.rows.map((r) => ({
        type: "sale",
        skuCode: r.master_sku ?? r.channel_sku,
        skuName: r.master_sku ?? r.channel_sku,
        createdAt: r.order_date,
        details: `${r.quantity} units sold via ${r.platform_source}`,
      })),
    };

    // Cache the response with period-specific key
    await CacheManager.set(cacheKey, response, DASHBOARD_CACHE_TTL);

    return NextResponse.json({
      success: true,
      data: response,
      cached: false,
    });
  } catch (error: unknown) {
    console.error("Error fetching dashboard analytics:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
