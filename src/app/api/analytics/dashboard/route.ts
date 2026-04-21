/**
 * Code Guide:
 * This API route owns the analytics / dashboard backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
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
      salesLast30Days,
      salesLast7Days,
      topSellingLast30Days,
      recentSales,
    ] = await Promise.all([
      // Total SKUs
      prisma.sKU.count(),

      // Total Collections
      prisma.sKUCollection.count(),

      listActivePlatformIntegrations().then((integrations) => integrations.length),

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

      // Sales stats - Last 30 days
      prisma.salesRecord.aggregate({
        where: {
          saleDate: { gte: thirtyDaysAgo },
        },
        _sum: {
          quantity: true,
          totalAmount: true,
        },
        _count: {
          id: true,
        },
      }),

      // Sales stats - Last 7 days
      prisma.salesRecord.aggregate({
        where: {
          saleDate: { gte: sevenDaysAgo },
        },
        _sum: {
          quantity: true,
          totalAmount: true,
        },
        _count: {
          id: true,
        },
      }),

      // Top selling SKUs - based on selected period
      prisma.salesRecord.groupBy({
        by: ["skuId"],
        where: {
          saleDate: { gte: periodStartDate, lte: periodEndDate },
        },
        _sum: {
          quantity: true,
          totalAmount: true,
        },
        _count: {
          id: true,
        },
        orderBy: {
          _sum: {
            quantity: "desc",
          },
        },
        take: 10,
      }),

      prisma.salesRecord.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          sku: {
            select: {
              skuCode: true,
              name: true,
            },
          },
        },
      }),
    ]);

    // groupBy returns IDs plus aggregates, so fetch display-friendly SKU data
    // separately before returning the list to the UI.
    const topSellingSkuIds = topSellingLast30Days.map((s) => s.skuId);
    const topSellingSkus = await prisma.sKU.findMany({
      where: { id: { in: topSellingSkuIds } },
      select: {
        id: true,
        skuCode: true,
        name: true,
        imageUrl: true,
        currentStock: true,
      },
    });

    const topSelling = topSellingLast30Days.map((sale) => {
      const sku = topSellingSkus.find((s) => s.id === sale.skuId);
      return {
        sku,
        totalQuantity: sale._sum.quantity || 0,
        totalRevenue: sale._sum.totalAmount || 0,
        orderCount: sale._count.id,
      };
    });

    // Calculate growth (7 days vs 30 days average)
    const avg30Days = (salesLast30Days._sum.quantity || 0) / 30;
    const avg7Days = (salesLast7Days._sum.quantity || 0) / 7;
    const growthPercentage =
      avg30Days > 0 ? ((avg7Days - avg30Days) / avg30Days) * 100 : 0;

    // Get sales trend by day for the selected period
    const dailySales = await prisma.salesRecord.groupBy({
      by: ["saleDate"],
      where: {
        saleDate: {
          gte: periodStartDate,
          lte: periodEndDate,
        },
      },
      _sum: {
        quantity: true,
        totalAmount: true,
      },
      orderBy: {
        saleDate: "asc",
      },
    });

    // Prisma groups by full DateTime values, so multiple records from the same
    // calendar day are merged one more time for chart rendering.
    const salesByDate = new Map<string, { quantity: number; revenue: number }>();
    for (const day of dailySales) {
      const dateKey = day.saleDate.toISOString().split("T")[0];
      const existing = salesByDate.get(dateKey) || { quantity: 0, revenue: 0 };
      salesByDate.set(dateKey, {
        quantity: existing.quantity + (day._sum.quantity || 0),
        revenue: existing.revenue + Number(day._sum.totalAmount || 0),
      });
    }

    const salesTrend = Array.from(salesByDate.entries())
      .map(([date, data]) => ({
        date,
        quantity: data.quantity,
        revenue: data.revenue,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const response = {
      overview: {
        totalSKUs,
        totalCollections,
        totalActiveIntegrations,
        lowStockCount: lowStockSKUs.length,
      },
      sales: {
        last30Days: {
          totalQuantity: salesLast30Days._sum.quantity || 0,
          totalRevenue: Number(salesLast30Days._sum.totalAmount || 0),
          orderCount: salesLast30Days._count.id,
        },
        last7Days: {
          totalQuantity: salesLast7Days._sum.quantity || 0,
          totalRevenue: Number(salesLast7Days._sum.totalAmount || 0),
          orderCount: salesLast7Days._count.id,
        },
        growthPercentage: Math.round(growthPercentage * 10) / 10,
        trend: salesTrend,
      },
      topSelling,
      lowStockSKUs,
      recentActivity: recentSales.map((sale) => ({
        type: "sale",
        skuCode: sale.sku.skuCode,
        skuName: sale.sku.name,
        createdAt: sale.createdAt,
        details: `${sale.quantity} units sold via ${sale.platform}`,
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
