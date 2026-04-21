/**
 * Code Guide:
 * Redis cache helpers used throughout the app.
 * This file standardizes cache keys, TTL rules, and invalidation behavior so API routes can reuse one cache strategy.
 */

import { Redis } from '@upstash/redis';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Cache key generators
export const CacheKeys = {
  // Historical sales data (immutable - cache forever)
  historicalSales: (skuId: string, year: number) =>
    `sales:${skuId}:${year}`,

  // Daily stats (cache for 24 hours)
  dailyStats: (skuId: string) =>
    `stats:daily:${skuId}`,

  // SKU data (cache for 1 hour)
  sku: (skuId: string) =>
    `sku:${skuId}`,

  // Trend data (cache for validUntil period)
  trendData: (skuId: string) =>
    `trend:${skuId}`,

  // Hot SKUs list (cache for 1 hour)
  hotSKUs: () =>
    `hot-skus`,
};

// TTL values in seconds
export const CacheTTL = {
  HISTORICAL: -1, // Never expire (immutable data)
  DAILY_STATS: 24 * 60 * 60, // 24 hours
  SKU_DATA: 60 * 60, // 1 hour
  TREND_DATA: 7 * 24 * 60 * 60, // 7 days
  HOT_SKUS: 60 * 60, // 1 hour
};

// Cache Manager class
export class CacheManager {
  /**
   * Get value from cache
   */
  static async get<T>(key: string): Promise<T | null> {
    if (!redis) return null;

    try {
      const value = await redis.get<T>(key);
      return value;
    } catch (error) {
      console.error(`Cache GET error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL
   */
  static async set<T>(
    key: string,
    value: T,
    ttl?: number
  ): Promise<boolean> {
    if (!redis) return false;

    try {
      if (ttl && ttl > 0) {
        await redis.setex(key, ttl, JSON.stringify(value));
      } else {
        await redis.set(key, JSON.stringify(value));
      }
      return true;
    } catch (error) {
      console.error(`Cache SET error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  static async delete(key: string): Promise<boolean> {
    if (!redis) return false;

    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error(`Cache DELETE error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  static async deletePattern(pattern: string): Promise<number> {
    if (!redis) return 0;

    try {
      // Upstash does not provide wildcard delete in one call, so we list the
      // matching keys first and then delete them.
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      return keys.length;
    } catch (error) {
      console.error(`Cache DELETE PATTERN error for ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Invalidate all caches for a specific SKU
   */
  static async invalidateSKU(skuId: string): Promise<void> {
    // One SKU can affect several cache families, so invalidation fans out to
    // every known key pattern tied to that SKU.
    const patterns = [
      `sales:${skuId}:*`,
      `stats:*:${skuId}`,
      `sku:${skuId}`,
      `trend:${skuId}`,
    ];

    await Promise.all(
      patterns.map((pattern) => this.deletePattern(pattern))
    );
  }

  /**
   * Track SKU query frequency (for identifying hot SKUs)
   */
  static async incrementSKUQueryCount(skuId: string): Promise<void> {
    if (!redis) return;

    try {
      await redis.zincrby('sku-queries', 1, skuId);
    } catch (error) {
      console.error('Error incrementing SKU query count:', error);
    }
  }

  /**
   * Get hot SKUs (most queried)
   */
  static async getHotSKUs(limit: number = 100): Promise<string[]> {
    if (!redis) return [];

    try {
      const skus = await redis.zrange('sku-queries', 0, limit - 1, {
        rev: true,
      });
      return skus as string[];
    } catch (error) {
      console.error('Error getting hot SKUs:', error);
      return [];
    }
  }

  /**
   * Cache with automatic TTL based on key type
   */
  static async cacheWithAutoTTL<T>(
    key: string,
    value: T
  ): Promise<boolean> {
    // Key prefixes act as the contract for how long different payload types
    // should live in cache.
    let ttl = CacheTTL.SKU_DATA; // default

    if (key.startsWith('sales:')) ttl = CacheTTL.HISTORICAL;
    else if (key.startsWith('stats:daily:')) ttl = CacheTTL.DAILY_STATS;
    else if (key.startsWith('trend:')) ttl = CacheTTL.TREND_DATA;
    else if (key.startsWith('hot-skus')) ttl = CacheTTL.HOT_SKUS;

    return this.set(key, value, ttl);
  }
}

export default redis;
