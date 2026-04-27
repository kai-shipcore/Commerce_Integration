import type { IntegrationConfig } from "@/lib/integrations/core/types";
import type { ShopifyConfig } from "@/lib/integrations/shopify/types";

const MASKED_SECRET = "********";

const CURRENT_API_VERSION = "2025-01";

export function applyShopifyDefaults(config: IntegrationConfig): ShopifyConfig {
  const rawDomain = String(config.shopDomain || "");
  const shopDomain = rawDomain
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();

  return {
    shopDomain,
    accessToken: String(config.accessToken || ""),
    apiVersion: CURRENT_API_VERSION,
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
