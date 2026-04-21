import type { IntegrationAdapter } from "@/lib/integrations/core/adapter";
import type { MarketplacePlatform } from "@/lib/integrations/core/types";
import { amazonAdapter } from "@/lib/integrations/amazon/adapter";
import { ebayAdapter } from "@/lib/integrations/ebay/adapter";
import { shopifyAdapter } from "@/lib/integrations/shopify/adapter";
import { walmartAdapter } from "@/lib/integrations/walmart/adapter";

const adapters: Record<MarketplacePlatform, IntegrationAdapter> = {
  shopify: shopifyAdapter,
  ebay: ebayAdapter,
  walmart: walmartAdapter,
  amazon: amazonAdapter,
};

export function getIntegrationAdapter(platform: string): IntegrationAdapter {
  const adapter = adapters[platform as MarketplacePlatform];

  if (!adapter) {
    throw new Error(`Platform ${platform} is not supported.`);
  }

  return adapter;
}

export function listIntegrationAdapters(): IntegrationAdapter[] {
  return Object.values(adapters);
}
