import {
  getPlatformIntegrationById,
  updatePlatformIntegration,
} from "@/lib/db/platform-integrations";
import { getIntegrationAdapter } from "@/lib/integrations/core/registry";
import type { SyncResult } from "@/lib/integrations/core/types";

export async function runIntegrationSync(
  integrationId: string,
  options: {
    createdAtMin?: string;
    fullSync?: boolean;
  } = {}
): Promise<SyncResult & { platform: string; name: string }> {
  const integration = await getPlatformIntegrationById(integrationId);

  if (!integration) {
    throw new Error("Integration not found");
  }

  if (!integration.isActive) {
    throw new Error("Integration is not active");
  }

  const adapter = getIntegrationAdapter(integration.platform);
  const result = await adapter.sync(integration, options);

  if (result.success) {
    await updatePlatformIntegration(integrationId, {
      lastSyncStatus: "success",
      lastSyncError: null,
      lastSyncAt: new Date(),
      syncCursor: null,
      incrementTotalOrdersSynced: result.ordersProcessed,
      incrementTotalRecordsSynced: result.salesRecordsCreated,
    });
  } else {
    await updatePlatformIntegration(integrationId, {
      lastSyncStatus: "failed",
      lastSyncError: result.errors.join("; "),
    });
  }

  return {
    ...result,
    platform: integration.platform,
    name: integration.name,
  };
}
