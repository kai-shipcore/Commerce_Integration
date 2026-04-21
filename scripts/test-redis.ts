/**
 * Code Guide:
 * Utility script for local development or debugging.
 * These scripts are not part of the production runtime; they help inspect data or validate infrastructure setup.
 */

import "dotenv/config";
import redis, { CacheManager, CacheKeys } from "../src/lib/redis";

async function testRedisConnection() {
  console.log("Testing Redis connection...\n");

  try {
    if (!redis) {
      console.error(
        "Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
      );
      process.exit(1);
    }

    console.log("Test 1: Basic SET/GET");
    await redis.set("test-key", "Hello Redis!");
    const value = await redis.get("test-key");
    console.log(`OK: Set and retrieved: ${value}\n`);

    console.log("Test 2: Cache Manager");
    const testData = {
      sku: "WIDGET-001",
      dailySales: 150,
      confidence: 0.85,
    };

    await CacheManager.set(CacheKeys.dailyStats("test-sku"), testData, 60);
    const cached = await CacheManager.get(CacheKeys.dailyStats("test-sku"));
    console.log("OK: Cached data:", cached, "\n");

    console.log("Test 3: Hot SKUs tracking");
    await CacheManager.incrementSKUQueryCount("WIDGET-001");
    await CacheManager.incrementSKUQueryCount("WIDGET-001");
    await CacheManager.incrementSKUQueryCount("GADGET-002");

    const hotSKUs = await CacheManager.getHotSKUs(10);
    console.log("OK: Hot SKUs:", hotSKUs, "\n");

    console.log("Test 4: Pattern deletion");
    await redis.set("stats:daily:sku1", "data1");
    await redis.set("stats:daily:sku1:secondary", "data2");
    await redis.set("stats:daily:sku2", "data3");

    const deleted = await CacheManager.deletePattern("stats:daily:sku1*");
    console.log(`OK: Deleted ${deleted} keys matching pattern\n`);

    console.log("Test 5: Auto TTL");
    await CacheManager.cacheWithAutoTTL(CacheKeys.dailyStats("WIDGET-001"), {
      sales: 100,
      revenue: 2999,
    });
    console.log("OK: Cached with auto TTL\n");

    await redis.del("test-key");
    await CacheManager.delete(CacheKeys.dailyStats("test-sku"));
    await CacheManager.deletePattern("stats:daily:*");
    await redis.del("sku-queries");

    console.log("All Redis tests passed.\n");
    console.log("Redis is ready to use for cache validation.");

    process.exit(0);
  } catch (error) {
    console.error("Redis test failed:", error);
    process.exit(1);
  }
}

testRedisConnection();
