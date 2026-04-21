import type { PlatformIntegrationRecord } from "@/lib/db/platform-integrations";
import type { IntegrationAdapter } from "@/lib/integrations/core/adapter";
import type {
  ConnectionCheckResult,
  IntegrationConfig,
  SyncResult,
} from "@/lib/integrations/core/types";
import {
  applyWalmartDefaults,
  maskWalmartConfig,
  validateWalmartConfig,
} from "@/lib/integrations/walmart/config";

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

      return {
        success: true,
        status: "credentials_saved",
        verification: "config_only",
        message: "Stored Walmart credentials look complete. Live connection check is not implemented yet.",
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
      errors: ["Walmart sync not implemented yet."],
    };
  },
};
