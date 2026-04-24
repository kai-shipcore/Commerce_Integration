import {
  getPlatformIntegrationById,
  updatePlatformIntegration,
} from "@/lib/db/platform-integrations";
import { getIntegrationAdapter } from "@/lib/integrations/core/registry";
import type { ConnectionCheckResult } from "@/lib/integrations/core/types";

export async function checkIntegrationConnection(
  integrationId: string
): Promise<{
  integration: NonNullable<Awaited<ReturnType<typeof getPlatformIntegrationById>>>;
  result: ConnectionCheckResult;
}> {
  const integration = await getPlatformIntegrationById(integrationId);

  if (!integration) {
    throw new Error("Integration not found");
  }

  const adapter = getIntegrationAdapter(integration.platform);
  const result = await adapter.checkConnection(integration.config);

  if (result.updatedConfig) {
    await updatePlatformIntegration(integrationId, { config: result.updatedConfig });
  }

  return { integration, result };
}
