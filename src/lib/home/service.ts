/**
 * Business logic for the home dashboard's sales-trend widget: cache
 * check/set and the growth-percent comparison against a prior period.
 */

import { CacheManager } from "@/lib/redis";
import { ServiceUnavailableError, ValidationError } from "@/lib/errors";
import { HomeRepository } from "@/lib/home/repository";

const CACHE_TTL = 5 * 60; // 5 minutes

export interface SalesTrendQuery {
  startDate: string | null;
  endDate: string | null;
  prevStartDate: string | null;
  prevEndDate: string | null;
}

export interface SalesTrendResult {
  data: unknown;
  cached: boolean;
}

export const HomeService = {
  async getSalesTrend(query: SalesTrendQuery): Promise<SalesTrendResult> {
    const { startDate, endDate, prevStartDate, prevEndDate } = query;
    if (!startDate || !endDate) {
      throw new ValidationError("startDate and endDate are required");
    }

    const cacheKey = `home:sales-trend:v3:${startDate}:${endDate}:${prevStartDate ?? ""}:${prevEndDate ?? ""}`;
    const cached = await CacheManager.get<unknown>(cacheKey);
    if (cached) {
      return { data: cached, cached: true };
    }

    if (!HomeRepository.isLookupAvailable()) {
      throw new ServiceUnavailableError("Lookup database unavailable");
    }

    const [trendRows, totalRow, prevQtyRaw] = await Promise.all([
      HomeRepository.getTrend(startDate, endDate),
      HomeRepository.getTotal(startDate, endDate),
      prevStartDate && prevEndDate ? HomeRepository.getPrevQty(prevStartDate, prevEndDate) : Promise.resolve(null),
    ]);

    const trend = trendRows.map((r) => ({
      date: r.day,
      quantity: parseInt(r.quantity, 10),
      revenue: parseFloat(r.revenue),
    }));

    const totalQty = parseInt(totalRow.quantity ?? "0", 10);
    const totalRevenue = parseFloat(totalRow.revenue ?? "0");
    const prevQty = prevQtyRaw !== null ? parseInt(prevQtyRaw, 10) : null;

    const growthPct =
      prevQty !== null && prevQty > 0
        ? Math.round(((totalQty - prevQty) / prevQty) * 1000) / 10
        : null;

    const data = {
      trend,
      total: { quantity: totalQty, revenue: totalRevenue },
      growthPct,
    };

    await CacheManager.set(cacheKey, data, CACHE_TTL);
    return { data, cached: false };
  },
};
