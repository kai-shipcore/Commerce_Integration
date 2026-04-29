import type { IntegrationConfig } from "@/lib/integrations/core/types";

const MASKED_SECRET = "********";

export function applyEbayDefaults(config: IntegrationConfig): IntegrationConfig {
  const result: IntegrationConfig = {
    clientId: String(config.clientId || ""),
    clientSecret: String(config.clientSecret || ""),
    refreshToken: String(config.refreshToken || ""),
    ruName: String(config.ruName || ""),
    environment: config.environment === "sandbox" ? "sandbox" : "production",
  };
  if (config.refreshTokenExpiresAt) {
    result.refreshTokenExpiresAt = config.refreshTokenExpiresAt;
  }
  return result;
}

export function validateEbayConfig(config: IntegrationConfig): void {
  const normalized = applyEbayDefaults(config);

  if (!normalized.clientId || !normalized.clientSecret) {
    throw new Error("eBay integration requires clientId and clientSecret");
  }
}

export function maskEbayConfig(config: IntegrationConfig): IntegrationConfig {
  const normalized = applyEbayDefaults(config);

  return {
    ...normalized,
    clientSecret: normalized.clientSecret ? MASKED_SECRET : undefined,
    refreshToken: normalized.refreshToken ? MASKED_SECRET : undefined,
  };
}
