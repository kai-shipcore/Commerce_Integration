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
    const isPartial = result.errors.length > 0;
    await updatePlatformIntegration(integrationId, {
      lastSyncStatus: isPartial ? "partial" : "success",
      lastSyncError: isPartial ? result.errors[0] : null,
      lastSyncAt: new Date(),
      // Only clear cursor on full completion — partial keeps cursor for resume
      ...(isPartial ? {} : { syncCursor: null }),
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
