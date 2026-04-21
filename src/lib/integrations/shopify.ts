import { ShopifyClient } from "@/lib/integrations/shopify/client";

export { ShopifyClient } from "@/lib/integrations/shopify/client";
export { shopifyAdapter } from "@/lib/integrations/shopify/adapter";

import { getPlatformIntegrationById } from "@/lib/db/platform-integrations";
import { runIntegrationSync } from "@/lib/integrations/core/sync-runner";

export async function syncShopifyOrders(
  integrationId: string,
  options: {
    createdAtMin?: string;
    fullSync?: boolean;
  } = {}
) {
  return runIntegrationSync(integrationId, options);
}

export async function getShopifyClient(integrationId: string): Promise<ShopifyClient | null> {
  const integration = await getPlatformIntegrationById(integrationId);

  if (!integration || integration.platform !== "shopify" || !integration.isActive) {
    return null;
  }

  const { applyShopifyDefaults } = await import("@/lib/integrations/shopify/config");

  return new ShopifyClient(applyShopifyDefaults(integration.config));
}
