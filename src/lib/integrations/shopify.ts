/**
 * Code Guide:
 * Integration service module.
 * This layer speaks to third-party commerce APIs and converts external payloads into the platform's internal database shape.
 */

import { prisma } from "@/lib/db/prisma";
import { lookupMasterSkusFromSupabase } from "@/lib/db/supabase-lookup";
import {
  getPlatformIntegrationById,
  updatePlatformIntegration,
} from "@/lib/db/platform-integrations";

// Shopify API configuration
interface ShopifyConfig {
  shopDomain: string; // e.g., "mystore.myshopify.com"
  accessToken: string;
  apiVersion: string;
}

// Shopify Order types - expanded to capture all available fields
interface ShopifyLineItem {
  id: number;
  sku: string;
  name: string;
  title: string;
  variant_title: string | null;
  quantity: number;
  price: string;
  fulfillment_status: string | null;
  product_id: number | null;
  variant_id: number | null;
  vendor: string | null;
  properties: Array<{ name: string; value: string }>;
  // Additional fields that might contain master SKU
  product_exists: boolean;
  grams: number;
  requires_shipping: boolean;
  taxable: boolean;
  gift_card: boolean;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string; // e.g., "#1001"
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  line_items: ShopifyLineItem[];
  total_price: string;
  subtotal_price: string;
  cancelled_at: string | null;
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

interface SyncResult {
  success: boolean;
  ordersProcessed: number;
  salesRecordsCreated: number;
  skusCreated: number;
  errors: string[];
}

/**
 * Shopify API Client
 * Handles communication with Shopify Admin REST API
 */
export class ShopifyClient {
  private config: ShopifyConfig;
  private baseUrl: string;

  constructor(config: ShopifyConfig) {
    this.config = config;
    this.baseUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}`;
  }

  /**
   * Make an authenticated request to Shopify API
   * Returns both the parsed JSON and the response headers for pagination
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.config.accessToken,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return { data, headers: response.headers };
  }

  /**
   * Parse Link header to get next page URL
   */
  private parseNextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    const links = linkHeader.split(",");
    for (const link of links) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Fetch orders from Shopify (single page)
   * @param params Query parameters for filtering orders
   */
  async getOrders(params: {
    created_at_min?: string;
    created_at_max?: string;
    status?: "open" | "closed" | "cancelled" | "any";
    limit?: number;
  }): Promise<{ orders: ShopifyOrder[]; nextPageUrl: string | null }> {
    const queryParams = new URLSearchParams();

    if (params.created_at_min) queryParams.set("created_at_min", params.created_at_min);
    if (params.created_at_max) queryParams.set("created_at_max", params.created_at_max);
    if (params.status) queryParams.set("status", params.status);
    queryParams.set("limit", (params.limit || 250).toString());

    const { data, headers } = await this.request<ShopifyOrdersResponse>(
      `/orders.json?${queryParams}`
    );

    const nextPageUrl = this.parseNextPageUrl(headers.get("link"));

    return { orders: data.orders, nextPageUrl };
  }

  /**
   * Fetch orders from a specific URL (for pagination)
   */
  private async getOrdersFromUrl(url: string): Promise<{ orders: ShopifyOrder[]; nextPageUrl: string | null }> {
    const { data, headers } = await this.request<ShopifyOrdersResponse>(url);
    const nextPageUrl = this.parseNextPageUrl(headers.get("link"));
    return { orders: data.orders, nextPageUrl };
  }

  /**
   * Fetch all orders with cursor-based pagination
   * Uses Shopify's Link header for reliable pagination
   */
  async getAllOrders(params: {
    created_at_min?: string;
    created_at_max?: string;
    status?: "open" | "closed" | "cancelled" | "any";
  }): Promise<ShopifyOrder[]> {
    const allOrders: ShopifyOrder[] = [];

    // First request
    let result = await this.getOrders({
      ...params,
      limit: 250,
    });

    allOrders.push(...result.orders);
    console.log(`Fetched ${allOrders.length} orders so far...`);

    // Follow pagination links
    while (result.nextPageUrl) {
      // Rate limiting - Shopify allows 2 requests/second
      await new Promise((resolve) => setTimeout(resolve, 500));

      result = await this.getOrdersFromUrl(result.nextPageUrl);
      allOrders.push(...result.orders);

      console.log(`Fetched ${allOrders.length} orders so far...`);
    }

    return allOrders;
  }

  /**
   * Test the connection to Shopify
   */
  async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
    try {
      const { data } = await this.request<{ shop: { name: string } }>("/shop.json");
      return { success: true, shopName: data.shop.name };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Lookup master SKUs for a batch of web SKUs using the separate Supabase connection
 */
async function lookupMasterSkus(
  webSkus: string[]
): Promise<Map<string, { parse1: string; parse2: string | null; parse3: string | null }>> {
  if (webSkus.length === 0) {
    return new Map();
  }

  try {
    const result = await lookupMasterSkusFromSupabase(webSkus);
    return result || new Map();
  } catch (error) {
    console.error('Error looking up master SKUs:', error);
    // If lookup fails, we'll proceed without master SKUs
    return new Map();
  }
}

/**
 * Process a batch of orders and save to database
 */
async function processOrderBatch(
  orders: ShopifyOrder[],
  integrationId: string,
  skuMap: Map<string, string>,
  masterSkuCache: Map<string, { parse1: string; parse2: string | null; parse3: string | null }>,
  result: SyncResult
): Promise<void> {
  // This function translates raw Shopify orders into the platform's internal
  // sales records, creating missing SKUs on demand so sync can keep moving.
  const salesRecords: {
    skuId: string;
    integrationId: string;
    platform: string;
    orderId: string;
    orderType: string;
    saleDate: Date;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    masterSkuCode: string | null;
    fulfilled: boolean;
    fulfilledDate: Date | null;
  }[] = [];

  // Collect all SKU codes from this batch
  const batchSkuCodes = new Set<string>();
  for (const order of orders) {
    for (const item of order.line_items) {
      if (item.sku && !skuMap.has(item.sku)) {
        batchSkuCodes.add(item.sku);
      }
    }
  }

  // Missing SKU creation is batched to avoid repeated lookups per line item.
  if (batchSkuCodes.size > 0) {
    const existingSkus = await prisma.sKU.findMany({
      where: { skuCode: { in: Array.from(batchSkuCodes) } },
      select: { id: true, skuCode: true },
    });

    existingSkus.forEach((s) => skuMap.set(s.skuCode, s.id));

    const stillMissing = Array.from(batchSkuCodes).filter((code) => !skuMap.has(code));

    if (stillMissing.length > 0) {
      // The Supabase lookup enriches web SKUs with business-level master SKU
      // codes so later analytics can aggregate variants together.
      const masterSkuLookup = await lookupMasterSkus(stillMissing);

      // Cache the master SKU lookups for sales record creation
      masterSkuLookup.forEach((value, key) => masterSkuCache.set(key, value));

      const newSkus = await prisma.sKU.createManyAndReturn({
        data: stillMissing.map((code) => {
          const masterInfo = masterSkuLookup.get(code);
          return {
            skuCode: code,
            masterSkuCode: masterInfo?.parse1 || null,
            name: code,
            currentStock: 0,
          };
        }),
        select: { id: true, skuCode: true, masterSkuCode: true },
      });

      newSkus.forEach((s) => skuMap.set(s.skuCode, s.id));
      result.skusCreated += newSkus.length;

      // Log master SKU mapping for visibility
      const mappedCount = newSkus.filter(s => s.masterSkuCode).length;
      if (mappedCount > 0) {
        console.log(`Mapped ${mappedCount}/${newSkus.length} SKUs to master SKUs`);
      }
    }
  }

  // Collect all SKU codes that need master SKU lookup (not in cache yet)
  const skusNeedingLookup = new Set<string>();
  for (const order of orders) {
    if (order.cancelled_at) continue;
    for (const item of order.line_items) {
      if (item.sku && !masterSkuCache.has(item.sku)) {
        skusNeedingLookup.add(item.sku);
      }
    }
  }

  // Lookup master SKUs for existing SKUs not yet in cache
  if (skusNeedingLookup.size > 0) {
    const masterSkuLookup = await lookupMasterSkus(Array.from(skusNeedingLookup));
    masterSkuLookup.forEach((value, key) => masterSkuCache.set(key, value));
  }

  // A single Shopify line item can expand into multiple SalesRecord rows when
  // the master-SKU parser returns parse2 or parse3 aliases.
  for (const order of orders) {
    if (order.cancelled_at) continue;

    for (const item of order.line_items) {
      if (!item.sku) continue;

      const skuId = skuMap.get(item.sku);
      if (!skuId) continue;

      const isFulfilled = item.fulfillment_status === "fulfilled";
      const masterInfo = masterSkuCache.get(item.sku);

      // Create primary sales record with parse1 master SKU
      salesRecords.push({
        skuId,
        integrationId,
        platform: "shopify",
        orderId: order.name,
        orderType: "actual_sale",
        saleDate: new Date(order.created_at),
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        totalAmount: parseFloat(item.price) * item.quantity,
        masterSkuCode: masterInfo?.parse1 || null,
        fulfilled: isFulfilled,
        fulfilledDate: isFulfilled ? new Date(order.created_at) : null,
      });

      // If parse2 exists, create duplicate sales record with same quantity
      if (masterInfo?.parse2) {
        salesRecords.push({
          skuId,
          integrationId,
          platform: "shopify",
          orderId: `${order.name}-p2`, // Suffix to avoid duplicate key
          orderType: "actual_sale",
          saleDate: new Date(order.created_at),
          quantity: item.quantity, // Same quantity, not split
          unitPrice: parseFloat(item.price),
          totalAmount: parseFloat(item.price) * item.quantity,
          masterSkuCode: masterInfo.parse2,
          fulfilled: isFulfilled,
          fulfilledDate: isFulfilled ? new Date(order.created_at) : null,
        });
      }

      // If parse3 exists, create duplicate sales record with same quantity
      if (masterInfo?.parse3) {
        salesRecords.push({
          skuId,
          integrationId,
          platform: "shopify",
          orderId: `${order.name}-p3`, // Suffix to avoid duplicate key
          orderType: "actual_sale",
          saleDate: new Date(order.created_at),
          quantity: item.quantity, // Same quantity, not split
          unitPrice: parseFloat(item.price),
          totalAmount: parseFloat(item.price) * item.quantity,
          masterSkuCode: masterInfo.parse3,
          fulfilled: isFulfilled,
          fulfilledDate: isFulfilled ? new Date(order.created_at) : null,
        });
      }
    }

    result.ordersProcessed++;
  }

  // Duplicate filtering matters because cursor resumes may revisit a page tail.
  if (salesRecords.length > 0) {
    const existingOrderIds = await prisma.salesRecord.findMany({
      where: {
        platform: "shopify",
        orderId: { in: salesRecords.map((r) => r.orderId) },
      },
      select: { orderId: true, skuId: true },
    });

    const existingKeys = new Set(
      existingOrderIds.map((r) => `${r.orderId}-${r.skuId}`)
    );

    const newRecords = salesRecords.filter(
      (r) => !existingKeys.has(`${r.orderId}-${r.skuId}`)
    );

    if (newRecords.length > 0) {
      await prisma.salesRecord.createMany({
        data: newRecords,
      });
      result.salesRecordsCreated += newRecords.length;
    }
  }
}

/**
 * Sync Shopify orders to SalesRecord
 * Processes orders in batches to handle large volumes (75k+ orders)
 */
export async function syncShopifyOrders(
  integrationId: string,
  options: {
    createdAtMin?: string;
    fullSync?: boolean;
  } = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    ordersProcessed: 0,
    salesRecordsCreated: 0,
    skusCreated: 0,
    errors: [],
  };

  try {
    // Get integration config from database
    const integration = await getPlatformIntegrationById(integrationId);

    if (!integration || integration.platform !== "shopify") {
      throw new Error("Shopify integration not found");
    }

    if (!integration.isActive) {
      throw new Error("Shopify integration is not active");
    }

    const config = integration.config as {
      shopDomain: string;
      accessToken: string;
      apiVersion: string;
    };

    const client = new ShopifyClient({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      apiVersion: config.apiVersion || "2024-01",
    });

    // Sync start differs by mode:
    // incremental sync starts from the last sync time,
    // full sync can resume from a saved pagination cursor.
    let createdAtMin = options.createdAtMin;

    // For full sync, check if we have a saved cursor to resume from
    const syncCursor = integration.syncCursor as { nextPageUrl?: string; lastCreatedAt?: string } | null;

    if (!options.fullSync && !createdAtMin) {
      // Incremental sync: use last sync time
      const lastSyncAt = integration.lastSyncAt;

      if (lastSyncAt) {
        createdAtMin = new Date(new Date(lastSyncAt).getTime() - 60000).toISOString();
      } else {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        createdAtMin = thirtyDaysAgo.toISOString();
      }
    }

    console.log(`Syncing orders${createdAtMin ? ` from ${createdAtMin}` : ' (all history)'}...`);

    // SKU cache to avoid repeated lookups
    const skuMap = new Map<string, string>();
    // Master SKU cache to store parse1/parse2/parse3 lookups
    const masterSkuCache = new Map<string, { parse1: string; parse2: string | null; parse3: string | null }>();

    // Resumable cursors are important for large stores where a full history
    // sync may span many Shopify pages and more than one process run.
    let nextPageUrl: string | null = null;
    if (options.fullSync && syncCursor?.nextPageUrl) {
      console.log('Resuming previous sync...');
      nextPageUrl = syncCursor.nextPageUrl;
    }

    // Fetch and process orders in batches
    if (nextPageUrl) {
      // Resume from saved cursor
      let pageResult = await client["getOrdersFromUrl"](nextPageUrl);

      while (true) {
        if (pageResult.orders.length > 0) {
          await processOrderBatch(pageResult.orders, integrationId, skuMap, masterSkuCache, result);
          console.log(`Processed ${result.ordersProcessed} orders, ${result.salesRecordsCreated} records created...`);

          // Save progress after each batch
          await updatePlatformIntegration(integrationId, {
            syncCursor: {
              nextPageUrl: pageResult.nextPageUrl,
              lastCreatedAt: pageResult.orders[pageResult.orders.length - 1]?.created_at,
            },
            incrementTotalOrdersSynced: pageResult.orders.length,
          });
        }

        if (!pageResult.nextPageUrl) break;

        await new Promise((resolve) => setTimeout(resolve, 500));
        pageResult = await client["getOrdersFromUrl"](pageResult.nextPageUrl);
      }
    } else {
      // Start fresh
      let pageResult = await client.getOrders({
        created_at_min: createdAtMin,
        status: "any",
        limit: 250,
      });

      while (true) {
        if (pageResult.orders.length > 0) {
          await processOrderBatch(pageResult.orders, integrationId, skuMap, masterSkuCache, result);
          console.log(`Processed ${result.ordersProcessed} orders, ${result.salesRecordsCreated} records created...`);

          // Save progress after each batch
          await updatePlatformIntegration(integrationId, {
            syncCursor: {
              nextPageUrl: pageResult.nextPageUrl,
              lastCreatedAt: pageResult.orders[pageResult.orders.length - 1]?.created_at,
            },
            incrementTotalOrdersSynced: pageResult.orders.length,
          });
        }

        if (!pageResult.nextPageUrl) break;

        await new Promise((resolve) => setTimeout(resolve, 500));
        pageResult = await client["getOrdersFromUrl"](pageResult.nextPageUrl);
      }
    }

    // Clear cursor and update last sync time on successful completion
    await updatePlatformIntegration(integrationId, {
      syncCursor: null,
      lastSyncAt: new Date(),
    });

    result.success = true;
  } catch (error: any) {
    console.error('Sync error:', error);
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Get Shopify client from integration ID
 */
export async function getShopifyClient(integrationId: string): Promise<ShopifyClient | null> {
  const integration = await getPlatformIntegrationById(integrationId);

  if (!integration || integration.platform !== "shopify" || !integration.isActive) {
    return null;
  }

  const config = integration.config as {
    shopDomain: string;
    accessToken: string;
    apiVersion: string;
  };

  return new ShopifyClient({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    apiVersion: config.apiVersion || "2024-01",
  });
}
