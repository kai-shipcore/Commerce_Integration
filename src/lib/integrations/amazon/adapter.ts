import type { PlatformIntegrationRecord } from "@/lib/db/platform-integrations";
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

      return {
        success: true,
        status: "credentials_saved",
        verification: "config_only",
        message: "Stored Amazon credentials look complete. Live connection check is not implemented yet.",
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
      errors: ["Amazon sync not implemented yet."],
    };
  },
};
