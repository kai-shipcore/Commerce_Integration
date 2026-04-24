import type { IntegrationConfig } from "@/lib/integrations/core/types";

const MASKED_SECRET = "********";

export interface WalmartConfig {
  [key: string]: unknown;
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  accessToken?: string;
  accessTokenExpiresAt?: string;
}

export function applyWalmartDefaults(config: IntegrationConfig): WalmartConfig {
  return {
    clientId: String(config.clientId || ""),
    clientSecret: String(config.clientSecret || ""),
    environment: config.environment === "sandbox" ? "sandbox" : "production",
    accessToken: config.accessToken ? String(config.accessToken) : undefined,
    accessTokenExpiresAt: config.accessTokenExpiresAt
      ? String(config.accessTokenExpiresAt)
      : undefined,
  };
}

export function validateWalmartConfig(config: IntegrationConfig): void {
  const normalized = applyWalmartDefaults(config);

  if (!normalized.clientId || !normalized.clientSecret) {
    throw new Error("Walmart integration requires clientId and clientSecret");
  }
}

export function maskWalmartConfig(config: IntegrationConfig): IntegrationConfig {
  const normalized = applyWalmartDefaults(config);

  return {
    clientId: normalized.clientId,
    environment: normalized.environment,
    clientSecret: normalized.clientSecret ? MASKED_SECRET : undefined,
  };
}
