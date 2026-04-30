import type { IntegrationConfig } from "@/lib/integrations/core/types";

const MASKED = "********";

export function applyAmazonDefaults(config: IntegrationConfig): IntegrationConfig {
  return {
    sellerId: String(config.sellerId || ""),
    marketplaceId: String(config.marketplaceId || ""),
    lwaClientId: String(config.lwaClientId || ""),
    lwaClientSecret: String(config.lwaClientSecret || ""),
    lwaRefreshToken: String(config.lwaRefreshToken || ""),
  };
}

export function validateAmazonConfig(config: IntegrationConfig): void {
  const c = applyAmazonDefaults(config);
  if (!c.sellerId || !c.marketplaceId || !c.lwaClientId || !c.lwaClientSecret || !c.lwaRefreshToken) {
    throw new Error(
      "Amazon integration requires sellerId, marketplaceId, lwaClientId, lwaClientSecret, and lwaRefreshToken"
    );
  }
}

export function maskAmazonConfig(config: IntegrationConfig): IntegrationConfig {
  const c = applyAmazonDefaults(config);
  return {
    ...c,
    lwaClientSecret: c.lwaClientSecret ? MASKED : undefined,
    lwaRefreshToken: c.lwaRefreshToken ? MASKED : undefined,
  };
}
