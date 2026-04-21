import type { IntegrationConfig } from "@/lib/integrations/core/types";
import type { ShopifyConfig } from "@/lib/integrations/shopify/types";

const MASKED_SECRET = "********";

export function applyShopifyDefaults(config: IntegrationConfig): ShopifyConfig {
  return {
    shopDomain: String(config.shopDomain || ""),
    accessToken: String(config.accessToken || ""),
    apiVersion: String(config.apiVersion || "2024-01"),
  };
}

export function validateShopifyConfig(config: IntegrationConfig): ShopifyConfig {
  const normalized = applyShopifyDefaults(config);

  if (!normalized.shopDomain || !normalized.accessToken) {
    throw new Error("Shopify integration requires shopDomain and accessToken");
  }

  return normalized;
}

export function maskShopifyConfig(config: IntegrationConfig): IntegrationConfig {
  const normalized = applyShopifyDefaults(config);

  return {
    ...normalized,
    accessToken: normalized.accessToken ? MASKED_SECRET : undefined,
  };
}
