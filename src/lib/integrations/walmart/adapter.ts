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
import type { MasterSkuInfo } from "@/lib/integrations/core/sku-resolution";
import {
  applyWalmartDefaults,
  maskWalmartConfig,
  validateWalmartConfig,
} from "@/lib/integrations/walmart/config";
import { WalmartClient } from "@/lib/integrations/walmart/client";
import { mapWalmartOrders } from "@/lib/integrations/walmart/mapper";

function buildIncrementalStart(lastSyncAt: string | null): string {
  if (lastSyncAt) {
    return new Date(new Date(lastSyncAt).getTime() - 60000).toISOString();
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return thirtyDaysAgo.toISOString();
}

export const walmartAdapter: IntegrationAdapter = {
  platform: "walmart",

  validateConfig(config: IntegrationConfig) {
    validateWalmartConfig(config);
  },

  applyDefaults(config: IntegrationConfig) {
    return applyWalmartDefaults(config);
  },

  maskConfig(config: IntegrationConfig) {
    return maskWalmartConfig(config);
  },

  async checkConnection(config: IntegrationConfig): Promise<ConnectionCheckResult> {
    try {
      validateWalmartConfig(config);

      const walmartConfig = applyWalmartDefaults(config);
      const client = new WalmartClient(walmartConfig);
      const { accessToken, expiresAt, isNew } = await client.ensureToken();

      const updatedConfig: IntegrationConfig | undefined = isNew
        ? { ...config, accessToken, accessTokenExpiresAt: expiresAt }
        : undefined;

      return {
        success: true,
        status: "connected",
        verification: "live",
        message: "Successfully connected to Walmart Marketplace API.",
        checkedAt: new Date().toISOString(),
        updatedConfig,
      };
    } catch (error: any) {
      return {
        success: false,
        status: "failed",
        verification: "live",
        message: error.message ?? "Failed to connect to Walmart Marketplace.",
        checkedAt: new Date().toISOString(),
      };
    }
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
      const walmartConfig = applyWalmartDefaults(integration.config);
      validateWalmartConfig(walmartConfig);

      const client = new WalmartClient(walmartConfig);
      const skuMap = new Map<string, string>();
      const masterSkuCache = new Map<string, MasterSkuInfo>();
      const syncCursor = integration.syncCursor as
        | { nextCursor?: string; lastOrderDate?: string }
        | null;

      let createdStartDate = options.createdAtMin;
      if (!options.fullSync && !createdStartDate) {
        createdStartDate = buildIncrementalStart(integration.lastSyncAt);
      }

      let pageResult =
        options.fullSync && syncCursor?.nextCursor
          ? await client.getOrdersFromCursor(syncCursor.nextCursor)
          : await client.getOrders({ createdStartDate, limit: 200 });

      while (true) {
        if (pageResult.orders.length > 0) {
          await persistNormalizedOrders({
            orders: mapWalmartOrders(pageResult.orders),
            integrationId: integration.id,
            platform: "walmart",
            skuMap,
            masterSkuCache,
            result,
          });

          const lastOrder = pageResult.orders[pageResult.orders.length - 1];
          await updatePlatformIntegration(integration.id, {
            syncCursor: {
              nextCursor: pageResult.nextCursor,
              lastOrderDate: new Date(lastOrder.orderDate).toISOString(),
            },
            // Persist the refreshed token so it survives across sync pages
            config: { ...walmartConfig },
          });
        }

        if (!pageResult.nextCursor) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        pageResult = await client.getOrdersFromCursor(pageResult.nextCursor);
      }

      result.success = true;
      return result;
    } catch (error: any) {
      console.error("Walmart sync error:", error);
      result.errors.push(error.message);
      return result;
    }
  },
};
