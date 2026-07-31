/**
 * Business logic for the home/analytics dashboard: date-range resolution
 * (preset period or custom start/end), cache check/set, and the
 * 7-day-vs-30-day growth-percentage comparison.
 */

import { CacheManager } from "@/lib/redis";
import { IntegrationsService } from "@/lib/integrations/service";
import { AnalyticsRepository } from "@/lib/analytics/repository";

const DASHBOARD_CACHE_KEY = "dashboard:analytics";
const DASHBOARD_CACHE_TTL = 5 * 60; // 5 minutes

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export interface DashboardQuery {
  period: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface DashboardResult {
  data: unknown;
  cached: boolean;
}

export const AnalyticsService = {
  async getDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const period = query.period || "30d";
    const now = new Date();
    let periodStartDate: Date;
    let periodEndDate: Date = now;
    let cacheKey: string;

    if (query.startDate && query.endDate) {
      periodStartDate = new Date(query.startDate);
      periodEndDate = new Date(query.endDate);
      periodEndDate.setHours(23, 59, 59, 999);
      cacheKey = `${DASHBOARD_CACHE_KEY}:${query.startDate}:${query.endDate}`;
    } else {
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
          periodStartDate = new Date(now.getFullYear(), 0, 1);
          break;
        case "all":
          periodStartDate = new Date(2000, 0, 1);
          break;
        default:
          periodStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      cacheKey = `${DASHBOARD_CACHE_KEY}:${period}`;
    }

    const cached = await CacheManager.get<unknown>(cacheKey);
    if (cached) {
      return { data: cached, cached: true };
    }

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalSKUs, totalCollections, totalActiveIntegrations, lowStockSKUs] = await Promise.all([
      AnalyticsRepository.countSkus(),
      AnalyticsRepository.countCollections(),
      IntegrationsService.listActiveIntegrations()
        .then((integrations) => integrations.length)
        .catch((error) => {
          console.warn("Dashboard integrations lookup failed, falling back to 0:", getErrorMessage(error));
          return 0;
        }),
      AnalyticsRepository.findLowStockSkus(),
    ]);

    const [salesLast30Days, salesLast7Days, topSkuRows, recentRows, trendRows] = await Promise.all([
      AnalyticsRepository.getSalesAgg(thirtyDaysAgo),
      AnalyticsRepository.getSalesAgg(sevenDaysAgo),
      AnalyticsRepository.getTopSkus(periodStartDate, periodEndDate),
      AnalyticsRepository.getRecentActivity(),
      AnalyticsRepository.getSalesTrend(periodStartDate, periodEndDate),
    ]);

    const topSelling = topSkuRows.map((row) => ({
      sku: { skuCode: row.master_sku, name: row.master_sku },
      totalQuantity: parseInt(row.qty, 10),
      totalRevenue: parseFloat(row.revenue),
      orderCount: parseInt(row.cnt, 10),
    }));

    const avg30Days = parseInt(salesLast30Days.qty, 10) / 30;
    const avg7Days = parseInt(salesLast7Days.qty, 10) / 7;
    const growthPercentage = avg30Days > 0 ? ((avg7Days - avg30Days) / avg30Days) * 100 : 0;

    const salesTrend = trendRows.map((r) => ({
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
      recentActivity: recentRows.map((r) => ({
        type: "sale",
        skuCode: r.master_sku ?? r.channel_sku,
        skuName: r.master_sku ?? r.channel_sku,
        createdAt: r.order_date,
        details: `${r.quantity} units sold via ${r.platform_source}`,
      })),
    };

    await CacheManager.set(cacheKey, response, DASHBOARD_CACHE_TTL);

    return { data: response, cached: false };
  },
};
