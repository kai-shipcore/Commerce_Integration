import type { PlatformIntegrationRecord } from "@/lib/db/platform-integrations";
import type {
  ConnectionCheckResult,
  IntegrationConfig,
  MarketplacePlatform,
  SyncResult,
} from "@/lib/integrations/core/types";

export interface IntegrationAdapter {
  platform: MarketplacePlatform;
  validateConfig(config: IntegrationConfig): void;
  applyDefaults(config: IntegrationConfig): IntegrationConfig;
  maskConfig(config: IntegrationConfig): IntegrationConfig;
  checkConnection(config: IntegrationConfig): Promise<ConnectionCheckResult>;
  sync(
    integration: PlatformIntegrationRecord,
    options?: {
      createdAtMin?: string;
      fullSync?: boolean;
    }
  ): Promise<SyncResult>;
}
