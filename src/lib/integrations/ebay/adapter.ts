import {
  updatePlatformIntegration,
  type PlatformIntegrationRecord,
} from "@/lib/db/platform-integrations";
import type { IntegrationAdapter } from "@/lib/integrations/core/adapter";
import { persistNormalizedOrders } from "@/lib/integrations/core/persist-sales";
import type { MasterSkuInfo } from "@/lib/integrations/core/sku-resolution";
import type {
  ConnectionCheckResult,
  IntegrationConfig,
  SyncResult,
} from "@/lib/integrations/core/types";
import {
  applyEbayDefaults,
  maskEbayConfig,
  validateEbayConfig,
} from "@/lib/integrations/ebay/config";
import { EbayClient } from "@/lib/integrations/ebay/client";
import { mapEbayOrders } from "@/lib/integrations/ebay/mapper";
import type { EbayConfig } from "@/lib/integrations/ebay/types";

function buildIncrementalStart(lastSyncAt: string | null): string {
  if (lastSyncAt) {
    return new Date(new Date(lastSyncAt).getTime() - 60000).toISOString();
  }
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return thirtyDaysAgo.toISOString();
}

function toEbayConfig(config: IntegrationConfig): EbayConfig {
  return {
    clientId: String(config.clientId ?? ""),
    clientSecret: String(config.clientSecret ?? ""),
    refreshToken: String(config.refreshToken ?? ""),
    environment: config.environment === "sandbox" ? "sandbox" : "production",
  };
}

export const ebayAdapter: IntegrationAdapter = {
  platform: "ebay",

  validateConfig(config: IntegrationConfig) {
    validateEbayConfig(config);
  },

  applyDefaults(config: IntegrationConfig) {
    return applyEbayDefaults(config);
  },

  maskConfig(config: IntegrationConfig) {
    return maskEbayConfig(config);
  },

  async checkConnection(config: IntegrationConfig): Promise<ConnectionCheckResult> {
    try {
      validateEbayConfig(config);
      const client = new EbayClient(toEbayConfig(config));
      const result = await client.testConnection(String(config.refreshToken));

      if (!result.success) {
        const msg = result.error?.startsWith("REFRESH_TOKEN_EXPIRED")
          ? "Refresh token has expired or is invalid. Use the Re-authenticate button to get a new token."
          : (result.error ?? "eBay connection failed.");
        return {
          success: false,
          status: "failed",
          verification: "live",
          message: msg,
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        success: true,
        status: "connected",
        verification: "live",
        message: "Successfully connected to eBay API.",
        checkedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        status: "failed",
        verification: "live",
        message: error.message,
        checkedAt: new Date().toISOString(),
      };
    }
  },

  async sync(
    integration: PlatformIntegrationRecord,
    options: { createdAtMin?: string; fullSync?: boolean } = {}
  ): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      ordersProcessed: 0,
      salesRecordsCreated: 0,
      skusCreated: 0,
      errors: [],
    };

    try {
      const config = applyEbayDefaults(integration.config);
      validateEbayConfig(config);

      const client = new EbayClient(toEbayConfig(config));
      const skuMap = new Map<string, string>();
      const masterSkuCache = new Map<string, MasterSkuInfo>();

      console.log("[eBay sync] Starting sync for integration:", integration.id, "fullSync:", options.fullSync);

      let accessToken: string;
      try {
        console.log("[eBay sync] Fetching access token...");
        accessToken = await client.getValidAccessToken(String(config.refreshToken));
        console.log("[eBay sync] Access token obtained successfully");
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith("REFRESH_TOKEN_EXPIRED")) {
          result.errors.push(
            "Refresh token has expired or is invalid. Use the Re-authenticate button to get a new token."
          );
          return result;
        }
        throw error;
      }

      const syncCursor = integration.syncCursor as { offset?: number } | null;

      let createdAtMin = options.createdAtMin;
      if (!options.fullSync && !createdAtMin) {
        createdAtMin = buildIncrementalStart(integration.lastSyncAt);
      }

      let offset = options.fullSync && syncCursor?.offset ? syncCursor.offset : 0;
      console.log("[eBay sync] createdAtMin:", createdAtMin ?? "(none — full history)", "startOffset:", offset);

      while (true) {
        const { orders, nextOffset } = await client.getOrders({
          accessToken,
          createdAtMin,
          offset,
          limit: 200,
        });

        console.log(`[eBay sync] Page at offset ${offset}: ${orders.length} orders fetched`);

        if (orders.length > 0) {
          const mapped = mapEbayOrders(orders);
          console.log(`[eBay sync] Mapped ${mapped.length} orders, active (non-cancelled): ${mapped.filter(o => !o.cancelledAt).length}`);
          console.log(`[eBay sync] Line items with SKU: ${mapped.flatMap(o => o.lineItems).length}`);

          try {
            await persistNormalizedOrders({
              orders: mapped,
              integrationId: integration.id,
              platform: "ebay",
              skuMap,
              masterSkuCache,
              result,
            });
            console.log(`[eBay sync] persistNormalizedOrders done — ordersProcessed=${result.ordersProcessed}, salesRecordsCreated=${result.salesRecordsCreated}`);
          } catch (persistError: unknown) {
            console.error("[eBay sync] persistNormalizedOrders threw:", persistError);
            throw persistError;
          }

          await updatePlatformIntegration(integration.id, {
            syncCursor: { offset: nextOffset },
          });
        }

        console.log(`[eBay sync] After page: ordersProcessed=${result.ordersProcessed}, salesRecordsCreated=${result.salesRecordsCreated}, skusCreated=${result.skusCreated}`);

        if (nextOffset === null) break;

        await new Promise((resolve) => setTimeout(resolve, 500));
        offset = nextOffset;
      }

      result.success = true;
      console.log("[eBay sync] Completed successfully:", result);
      return result;
    } catch (error: unknown) {
      console.error("[eBay sync] Fatal error:", error);
      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }
  },
};
