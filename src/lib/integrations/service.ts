import {
  createPlatformIntegration,
  deletePlatformIntegration,
  getPlatformIntegrationById,
  listActivePlatformIntegrations,
  listPlatformIntegrations,
  updatePlatformIntegration,
  type PlatformIntegrationRecord,
} from "@/lib/integrations/repository";
import { getIntegrationAdapter } from "@/lib/integrations/core/registry";
import { applyEbayDefaults, validateEbayConfig } from "@/lib/integrations/ebay/config";
import { EbayClient } from "@/lib/integrations/ebay/client";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";

type TokenStatus = "valid" | "expiring_soon" | "expired" | "none";

const TOKEN_BUFFER_MS = 5 * 60 * 1000;
const EBAY_EXPIRY_WARN_DAYS = 30;

function getWalmartTokenStatus(config: Record<string, unknown>): TokenStatus {
  const token = config.accessToken as string | undefined;
  const expiresAt = config.accessTokenExpiresAt as string | undefined;

  if (!token || !expiresAt) return "none";

  const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();

  if (msUntilExpiry <= 0) return "expired";
  if (msUntilExpiry <= TOKEN_BUFFER_MS) return "expiring_soon";
  return "valid";
}

function getEbayTokenStatus(config: Record<string, unknown>): TokenStatus {
  if (!config.refreshToken) return "none";

  const expiresAt = config.refreshTokenExpiresAt as string | undefined;
  if (expiresAt) {
    const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0) return "expired";
    if (daysLeft < EBAY_EXPIRY_WARN_DAYS) return "expiring_soon";
  }

  return "valid";
}

function ebayAuthUrl(config: Record<string, unknown>, integrationId: string): string {
  const ruName = String(config.ruName || "") || process.env.EBAY_RUNAME;
  if (!ruName) {
    throw new Error(
      "RuName is not configured. Edit this integration and add the RuName from your eBay developer app."
    );
  }

  try {
    validateEbayConfig(config);
  } catch {
    throw new ValidationError(
      "Integration is missing clientId or clientSecret. Please edit the integration first."
    );
  }

  const client = new EbayClient({
    clientId: String(config.clientId),
    clientSecret: String(config.clientSecret),
    refreshToken: "",
    environment: config.environment === "sandbox" ? "sandbox" : "production",
  });

  return client.buildAuthorizationUrl(ruName, integrationId);
}

/**
 * Business logic for marketplace integrations: orchestrates the per-platform
 * adapters (validate/mask/sync), token-status display, the advisory sync flow
 * (direct or Inngest-queued), the eBay OAuth exchange, and audit logging.
 * Data access lives in src/lib/integrations/repository.ts; the adapters
 * themselves (src/lib/integrations/{shopify,amazon,ebay,walmart}/*) are pure
 * integration clients and are out of scope for this layer.
 */
export const IntegrationsService = {
  async listIntegrations() {
    const integrations = await listPlatformIntegrations();

    return integrations.map(({ config, syncCursor: _syncCursor, ...integration }) => ({
      ...integration,
      tokenStatus:
        integration.platform === "walmart"
          ? getWalmartTokenStatus(config)
          : integration.platform === "ebay"
          ? getEbayTokenStatus(config)
          : undefined,
    }));
  },

  listActiveIntegrations(): Promise<PlatformIntegrationRecord[]> {
    return listActivePlatformIntegrations();
  },

  async getIntegrationForDisplay(id: string) {
    const integration = await getPlatformIntegrationById(id);
    if (!integration) throw new NotFoundError("Integration not found");

    const adapter = getIntegrationAdapter(integration.platform);
    const maskedConfig = adapter.maskConfig(integration.config);

    return { ...integration, config: maskedConfig };
  },

  async createIntegration(data: {
    platform: "shopify" | "walmart" | "ebay" | "amazon";
    name: string;
    config: Record<string, unknown>;
  }) {
    const adapter = getIntegrationAdapter(data.platform);
    const config = adapter.applyDefaults(data.config);
    adapter.validateConfig(config);

    if (data.platform === "shopify") {
      const testResult = await adapter.checkConnection(config);
      if (!testResult.success) {
        throw new ValidationError(`Failed to connect to Shopify: ${testResult.message}`);
      }
    }

    return createPlatformIntegration({
      platform: data.platform,
      name: data.name,
      isActive: true,
      config,
    });
  },

  async updateIntegration(
    id: string,
    data: { name?: string; isActive?: boolean; config?: Record<string, unknown> },
    ip: string | null
  ) {
    const existing = await getPlatformIntegrationById(id);
    if (!existing) throw new NotFoundError("Integration not found");

    const adapter = getIntegrationAdapter(existing.platform);

    const updateData: { name?: string; isActive?: boolean; config?: Record<string, unknown> } = {};
    if (data.name) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.config) {
      const nextConfig = adapter.applyDefaults({ ...existing.config, ...data.config });
      adapter.validateConfig(nextConfig);
      updateData.config = nextConfig;
    }

    const integration = await updatePlatformIntegration(id, updateData);

    const session = await auth();
    void logAudit({
      entityType: "integration",
      entityId: id,
      entityLabel: `${existing.platform} - ${existing.name}`,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "config_update",
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: integration?.name, isActive: integration?.isActive },
      ip,
    });

    return integration;
  },

  async deleteIntegration(id: string, ip: string | null) {
    const existing = await getPlatformIntegrationById(id);
    if (!existing) throw new NotFoundError("Integration not found");

    await deletePlatformIntegration(id);

    const session = await auth();
    void logAudit({
      entityType: "integration",
      entityId: id,
      entityLabel: `${existing.platform} - ${existing.name}`,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { name: existing.name, platform: existing.platform, isActive: existing.isActive },
      ip,
    });
  },

  async checkConnection(id: string) {
    const integration = await getPlatformIntegrationById(id);
    if (!integration) throw new NotFoundError("Integration not found");

    const adapter = getIntegrationAdapter(integration.platform);
    const result = await adapter.checkConnection(integration.config);

    if (result.updatedConfig) {
      await updatePlatformIntegration(id, { config: result.updatedConfig });
    }

    return result;
  },

  async getSyncStatus(id: string) {
    const integration = await getPlatformIntegrationById(id);
    if (!integration) throw new NotFoundError("Integration not found");

    return {
      integrationId: id,
      platform: integration.platform,
      name: integration.name,
      isActive: integration.isActive,
      sync: {
        lastSyncAt: integration.lastSyncAt,
        status: integration.lastSyncStatus,
        error: integration.lastSyncError,
        totalOrders: integration.totalOrdersSynced,
        totalRecords: integration.totalRecordsSynced,
        cursor: integration.syncCursor,
      },
    };
  },

  async runSync(id: string, options: { fullSync?: boolean; useInngest?: boolean } = {}) {
    const integration = await getPlatformIntegrationById(id);
    if (!integration) throw new NotFoundError("Integration not found");
    if (!integration.isActive) throw new ValidationError("Integration is not active");

    if (options.useInngest) {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "app/sync.trigger",
        data: { integrationId: id, fullSync: options.fullSync ?? false },
      });

      return {
        queued: true as const,
        integrationId: id,
        platform: integration.platform,
        name: integration.name,
        fullSync: options.fullSync ?? false,
      };
    }

    console.log(`[integrations] Starting sync for ${integration.platform} / ${integration.name}`);
    const adapter = getIntegrationAdapter(integration.platform);
    const result = await adapter.sync(integration, { fullSync: options.fullSync });
    console.log(`[integrations] Sync result:`, JSON.stringify(result));

    if (result.success) {
      const isPartial = result.errors.length > 0;
      await updatePlatformIntegration(id, {
        lastSyncStatus: isPartial ? "partial" : "success",
        lastSyncError: isPartial ? result.errors[0] : null,
        lastSyncAt: new Date(),
        // Only clear cursor on full completion — partial keeps cursor for resume
        ...(isPartial ? {} : { syncCursor: null }),
        incrementTotalOrdersSynced: result.ordersProcessed,
        incrementTotalRecordsSynced: result.salesRecordsCreated,
      });
    } else {
      await updatePlatformIntegration(id, {
        lastSyncStatus: "failed",
        lastSyncError: result.errors.join("; "),
      });
    }

    return {
      queued: false as const,
      ...result,
      platform: integration.platform,
      name: integration.name,
    };
  },

  async buildEbayAuthUrl(id: string): Promise<string> {
    const integration = await getPlatformIntegrationById(id);
    if (!integration || integration.platform !== "ebay") {
      throw new NotFoundError("eBay integration not found");
    }

    const config = applyEbayDefaults(integration.config);
    return ebayAuthUrl(config, id);
  },

  async completeEbayAuth(code: string, integrationId: string): Promise<void> {
    const integration = await getPlatformIntegrationById(integrationId);
    if (!integration || integration.platform !== "ebay") {
      throw new NotFoundError("eBay integration not found");
    }

    const config = applyEbayDefaults(integration.config);
    const ruName = String(config.ruName || "") || process.env.EBAY_RUNAME;
    if (!ruName) {
      throw new Error("RuName is not configured for this integration");
    }

    const client = new EbayClient({
      clientId: String(config.clientId),
      clientSecret: String(config.clientSecret),
      refreshToken: "",
      environment: config.environment === "sandbox" ? "sandbox" : "production",
    });

    const { refreshToken, refreshTokenExpiresAt } = await client.exchangeCodeForTokens(code, ruName);

    await updatePlatformIntegration(integrationId, {
      config: {
        ...integration.config,
        refreshToken,
        refreshTokenExpiresAt,
      },
    });
  },
};
