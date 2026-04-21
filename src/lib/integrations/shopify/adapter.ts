import {
  updatePlatformIntegration,
  type PlatformIntegrationRecord,
} from "@/lib/db/platform-integrations";
import type { IntegrationAdapter } from "@/lib/integrations/core/adapter";
import { persistNormalizedOrders } from "@/lib/integrations/core/persist-sales";
import type {
  ConnectionCheckResult,
  IntegrationConfig,
  SyncResult,
} from "@/lib/integrations/core/types";
import {
  applyShopifyDefaults,
  maskShopifyConfig,
  validateShopifyConfig,
} from "@/lib/integrations/shopify/config";
import { ShopifyClient } from "@/lib/integrations/shopify/client";
import { mapShopifyOrders } from "@/lib/integrations/shopify/mapper";
import type { MasterSkuInfo } from "@/lib/integrations/core/sku-resolution";

function buildIncrementalStart(lastSyncAt: string | null): string {
  if (lastSyncAt) {
    return new Date(new Date(lastSyncAt).getTime() - 60000).toISOString();
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return thirtyDaysAgo.toISOString();
}

export const shopifyAdapter: IntegrationAdapter = {
  platform: "shopify",

  validateConfig(config: IntegrationConfig) {
    validateShopifyConfig(config);
  },

  applyDefaults(config: IntegrationConfig) {
    return applyShopifyDefaults(config);
  },

  maskConfig(config: IntegrationConfig) {
    return maskShopifyConfig(config);
  },

  async checkConnection(config: IntegrationConfig): Promise<ConnectionCheckResult> {
    const normalized = validateShopifyConfig(config);
    const client = new ShopifyClient(normalized);
    const result = await client.testConnection();

    if (!result.success) {
      return {
        success: false,
        status: "failed",
        verification: "live",
        message: result.error || "Connection failed",
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      success: true,
      status: "connected",
      verification: "live",
      message: `Connected to Shopify store ${result.shopName || normalized.shopDomain}.`,
      checkedAt: new Date().toISOString(),
    };
  },

  async sync(
    integration: PlatformIntegrationRecord,
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
      const config = validateShopifyConfig(integration.config);
      const client = new ShopifyClient(config);
      const skuMap = new Map<string, string>();
      const masterSkuCache = new Map<string, MasterSkuInfo>();
      const syncCursor = integration.syncCursor as
        | { nextPageUrl?: string; lastCreatedAt?: string }
        | null;

      let createdAtMin = options.createdAtMin;
      if (!options.fullSync && !createdAtMin) {
        createdAtMin = buildIncrementalStart(integration.lastSyncAt);
      }

      let pageResult =
        options.fullSync && syncCursor?.nextPageUrl
          ? await client.getOrdersFromUrl(syncCursor.nextPageUrl)
          : await client.getOrders({
              created_at_min: createdAtMin,
              status: "any",
              limit: 250,
            });

      while (true) {
        if (pageResult.orders.length > 0) {
          await persistNormalizedOrders({
            orders: mapShopifyOrders(pageResult.orders),
            integrationId: integration.id,
            platform: "shopify",
            skuMap,
            masterSkuCache,
            result,
          });

          await updatePlatformIntegration(integration.id, {
            syncCursor: {
              nextPageUrl: pageResult.nextPageUrl,
              lastCreatedAt: pageResult.orders[pageResult.orders.length - 1]?.created_at,
            },
          });
        }

        if (!pageResult.nextPageUrl) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        pageResult = await client.getOrdersFromUrl(pageResult.nextPageUrl);
      }

      result.success = true;
      return result;
    } catch (error: any) {
      console.error("Shopify sync error:", error);
      result.errors.push(error.message);
      return result;
    }
  },
};
