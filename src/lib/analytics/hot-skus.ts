/**
 * Code Guide:
 * Analytics helper module.
 * It prepares derived metrics and supporting lookup data that higher-level APIs or jobs can reuse.
 */

import { CacheManager } from '../redis';
import { getPrimaryPool } from '../db/primary-db';

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

    const pool = getPrimaryPool();
    const { rows: topSellingRows } = await pool.query<{ master_sku: string }>(
      `SELECT i.master_sku
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE o.order_date >= $1 AND i.is_counted_in_demand = true AND i.master_sku IS NOT NULL
       GROUP BY i.master_sku
       ORDER BY SUM(i.quantity) DESC
       LIMIT $2`,
      [thirtyDaysAgo, limit]
    );

    // Combine and deduplicate
    const hotSKUSet = new Set<string>();

    // Add queried SKUs (from cache)
    queriedSKUs.forEach((skuId) => hotSKUSet.add(skuId));

    // Add top selling SKUs
    topSellingRows.forEach((record) => {
      if (record.master_sku) hotSKUSet.add(record.master_sku);
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
