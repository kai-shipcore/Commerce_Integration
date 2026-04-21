import type { IntegrationConfig } from "@/lib/integrations/core/types";

const MASKED_SECRET = "********";

export function applyAmazonDefaults(config: IntegrationConfig): IntegrationConfig {
  return {
    sellerId: String(config.sellerId || ""),
    marketplaceId: String(config.marketplaceId || ""),
    accessKeyId: String(config.accessKeyId || ""),
    secretAccessKey: String(config.secretAccessKey || ""),
    region: String(config.region || "us-east-1"),
  };
}

export function validateAmazonConfig(config: IntegrationConfig): void {
  const normalized = applyAmazonDefaults(config);

  if (
    !normalized.sellerId ||
    !normalized.marketplaceId ||
    !normalized.accessKeyId ||
    !normalized.secretAccessKey
  ) {
    throw new Error(
      "Amazon integration requires sellerId, marketplaceId, accessKeyId, and secretAccessKey"
    );
  }
}

export function maskAmazonConfig(config: IntegrationConfig): IntegrationConfig {
  const normalized = applyAmazonDefaults(config);

  return {
    ...normalized,
    secretAccessKey: normalized.secretAccessKey ? MASKED_SECRET : undefined,
  };
}
