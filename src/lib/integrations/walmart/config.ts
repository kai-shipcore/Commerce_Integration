import type { IntegrationConfig } from "@/lib/integrations/core/types";

const MASKED_SECRET = "********";

export function applyWalmartDefaults(config: IntegrationConfig): IntegrationConfig {
  return {
    consumerId: String(config.consumerId || ""),
    privateKey: String(config.privateKey || ""),
    channelType: String(config.channelType || ""),
    environment: config.environment === "sandbox" ? "sandbox" : "production",
  };
}

export function validateWalmartConfig(config: IntegrationConfig): void {
  const normalized = applyWalmartDefaults(config);

  if (!normalized.consumerId || !normalized.privateKey || !normalized.channelType) {
    throw new Error("Walmart integration requires consumerId, privateKey, and channelType");
  }
}

export function maskWalmartConfig(config: IntegrationConfig): IntegrationConfig {
  const normalized = applyWalmartDefaults(config);

  return {
    ...normalized,
    privateKey: normalized.privateKey ? MASKED_SECRET : undefined,
  };
}
