import type { IntegrationConfig } from "@/lib/integrations/core/types";

const MASKED_SECRET = "********";

export function applyEbayDefaults(config: IntegrationConfig): IntegrationConfig {
  return {
    clientId: String(config.clientId || ""),
    clientSecret: String(config.clientSecret || ""),
    refreshToken: String(config.refreshToken || ""),
    environment: config.environment === "sandbox" ? "sandbox" : "production",
  };
}

export function validateEbayConfig(config: IntegrationConfig): void {
  const normalized = applyEbayDefaults(config);

  if (!normalized.clientId || !normalized.clientSecret || !normalized.refreshToken) {
    throw new Error("eBay integration requires clientId, clientSecret, and refreshToken");
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
