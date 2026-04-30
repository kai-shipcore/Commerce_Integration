import {
  updatePlatformIntegration,
  type PlatformIntegrationRecord,
} from "@/lib/db/platform-integrations";
import type { IntegrationAdapter } from "@/lib/integrations/core/adapter";
import type {
  ConnectionCheckResult,
  IntegrationConfig,
  SyncResult,
} from "@/lib/integrations/core/types";
import {
  applyAmazonDefaults,
  maskAmazonConfig,
  validateAmazonConfig,
} from "@/lib/integrations/amazon/config";
import { AmazonClient } from "@/lib/integrations/amazon/client";
import { mapAmazonOrders } from "@/lib/integrations/amazon/mapper";
import { persistNormalizedOrders } from "@/lib/integrations/core/persist-sales";
import type { MasterSkuInfo } from "@/lib/integrations/core/sku-resolution";

export const amazonAdapter: IntegrationAdapter = {
  platform: "amazon",

  validateConfig(config: IntegrationConfig) {
    validateAmazonConfig(config);
  },

  applyDefaults(config: IntegrationConfig) {
    return applyAmazonDefaults(config);
  },

  maskConfig(config: IntegrationConfig) {
    return maskAmazonConfig(config);
  },

  async checkConnection(config: IntegrationConfig): Promise<ConnectionCheckResult> {
    try {
      validateAmazonConfig(config);

      // Exchange refresh token for access token via LWA
      const res = await fetch("https://api.amazon.com/auth/o2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: String(config.lwaRefreshToken),
          client_id: String(config.lwaClientId),
          client_secret: String(config.lwaClientSecret),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body.error_description || body.error || res.statusText;
        return {
          success: false,
          status: "failed",
          verification: "live",
          message: `LWA token request failed: ${detail}`,
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        success: true,
        status: "connected",
        verification: "live",
        message: "Amazon LWA token obtained successfully. Credentials are valid.",
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

  async sync(integration: PlatformIntegrationRecord, options: { fullSync?: boolean } = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      ordersProcessed: 0,
      salesRecordsCreated: 0,
      skusCreated: 0,
      errors: [],
    };

    try {
      validateAmazonConfig(integration.config);
      const cfg = applyAmazonDefaults(integration.config);

      const client = new AmazonClient({
        sellerId: String(cfg.sellerId),
        marketplaceId: String(cfg.marketplaceId),
        lwaClientId: String(cfg.lwaClientId),
        lwaClientSecret: String(cfg.lwaClientSecret),
        lwaRefreshToken: String(cfg.lwaRefreshToken),
      });

      // Resume from saved cursor if available (previous sync was rate-limited mid-pagination)
      const savedCursor = integration.syncCursor as { nextToken?: string } | null;
      let nextToken: string | undefined = savedCursor?.nextToken;

      // Only use createdAfter for fresh starts (no resume cursor)
      let createdAfter: string | undefined;
      if (!nextToken) {
        if (integration.lastSyncAt) {
          // Use lastSyncAt minus 2 days to guarantee no gap between sync runs
          createdAfter = new Date(new Date(integration.lastSyncAt).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
        } else {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          createdAfter = thirtyDaysAgo.toISOString();
        }
      }

      // fullSync: loop all pages. Sync New: one page per run (cursor saved for resume).
      do {
        const page = await client.getOrders({ createdAfter, nextToken });

        if (page.rateLimited) {
          result.errors.push("Amazon rate limit reached. Run sync again to continue from where it left off.");
          result.success = result.ordersProcessed > 0;
          return result;
        }

        if (page.orders.length > 0) {
          const itemsMap = new Map<string, Awaited<ReturnType<typeof client.getOrderItems>>>();

          await Promise.all(
            page.orders.map(async (order) => {
              const items = await client.getOrderItems(order.AmazonOrderId);
              if (items.length > 0) itemsMap.set(order.AmazonOrderId, items);
            })
          );

          const normalized = mapAmazonOrders(page.orders, itemsMap);
          await persistNormalizedOrders({
            orders: normalized,
            integrationId: integration.id,
            platform: "amazon",
            skuMap: new Map(),
            masterSkuCache: new Map(),
            result,
          });
        }

        nextToken = page.nextToken;

        await updatePlatformIntegration(integration.id, {
          syncCursor: nextToken ? { nextToken } : null,
        });
      } while (options.fullSync && nextToken);

      result.success = true;
      return result;
    } catch (error: any) {
      console.error("Amazon sync error:", error);
      result.errors.push(error.message);
      // If we already processed some orders, treat as partial success so lastSyncAt is saved
      if (result.ordersProcessed > 0) {
        result.success = true;
      }
      return result;
    }
  },
};
