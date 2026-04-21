import type { PlatformIntegrationRecord } from "@/lib/db/platform-integrations";
import type { IntegrationAdapter } from "@/lib/integrations/core/adapter";
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

      return {
        success: true,
        status: "credentials_saved",
        verification: "config_only",
        message: "Stored eBay credentials look complete. Live connection check is not implemented yet.",
        checkedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        status: "incomplete",
        verification: "config_only",
        message: error.message,
        checkedAt: new Date().toISOString(),
      };
    }
  },

  async sync(_integration: PlatformIntegrationRecord): Promise<SyncResult> {
    return {
      success: false,
      ordersProcessed: 0,
      salesRecordsCreated: 0,
      skusCreated: 0,
      errors: ["eBay sync not implemented yet."],
    };
  },
};
