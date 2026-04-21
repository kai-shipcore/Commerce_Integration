/**
 * Code Guide:
 * Analytics helper module.
 * It prepares derived metrics and supporting lookup data that higher-level APIs or jobs can reuse.
 */

import { CacheManager } from '../redis';
import { prisma } from '../db/prisma';

/**
 * Identify hot SKUs based on query frequency and recent sales
 */
export async function identifyHotSKUs(limit: number = 1000): Promise<string[]> {
  try {
    // "Hot" blends user behavior with business behavior:
    // frequently opened SKUs and recent top sellers both deserve priority.
    // Get most queried SKUs from Redis
    const queriedSKUs = await CacheManager.getHotSKUs(limit * 2); // Get 2x to merge with sales data

    // Get SKUs with high recent sales (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const topSellingSKUs = await prisma.salesRecord.groupBy({
      by: ['skuId'],
      _sum: {
        quantity: true,
      },
      where: {
        saleDate: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: limit,
    });

    // Combine and deduplicate
    const hotSKUSet = new Set<string>();

    // Add queried SKUs (from cache)
    queriedSKUs.forEach((skuId) => hotSKUSet.add(skuId));

    // Add top selling SKUs
    topSellingSKUs.forEach((record) => {
      if (record.skuId) {
        hotSKUSet.add(record.skuId);
      }
    });

    // Convert to array and limit
    const hotSKUs = Array.from(hotSKUSet).slice(0, limit);

    console.log(`Identified ${hotSKUs.length} hot SKUs`);

    return hotSKUs;
  } catch (error) {
    console.error('Error identifying hot SKUs:', error);
    return [];
  }
}
