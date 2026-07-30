import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  listPlatformIntegrations: vi.fn(),
  listActivePlatformIntegrations: vi.fn(),
  getPlatformIntegrationById: vi.fn(),
  createPlatformIntegration: vi.fn(),
  updatePlatformIntegration: vi.fn(),
  deletePlatformIntegration: vi.fn(),
};

const adapterMock = {
  validateConfig: vi.fn(),
  applyDefaults: vi.fn((c: Record<string, unknown>) => c),
  maskConfig: vi.fn((c: Record<string, unknown>) => ({ ...c, masked: true })),
  checkConnection: vi.fn(),
  sync: vi.fn(),
};

const getIntegrationAdapterMock = vi.fn(() => adapterMock);
const authMock = vi.fn();
const logAuditMock = vi.fn();
const inngestSendMock = vi.fn();

const applyEbayDefaultsMock = vi.fn((c: Record<string, unknown>) => c);
const validateEbayConfigMock = vi.fn();
const buildAuthorizationUrlMock = vi.fn();
const exchangeCodeForTokensMock = vi.fn();

vi.mock("@/lib/integrations/repository", () => repositoryMock);
vi.mock("@/lib/integrations/core/registry", () => ({ getIntegrationAdapter: getIntegrationAdapterMock }));
vi.mock("@/lib/integrations/ebay/config", () => ({
  applyEbayDefaults: applyEbayDefaultsMock,
  validateEbayConfig: validateEbayConfigMock,
}));
vi.mock("@/lib/integrations/ebay/client", () => ({
  EbayClient: vi.fn().mockImplementation(function EbayClient(this: Record<string, unknown>) {
    this.buildAuthorizationUrl = buildAuthorizationUrlMock;
    this.exchangeCodeForTokens = exchangeCodeForTokensMock;
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: inngestSendMock } }));

const { IntegrationsService } = await import("@/lib/integrations/service");

const INTEGRATION = {
  id: "int-1",
  platform: "shopify",
  name: "Main Store",
  isActive: true,
  config: { shopDomain: "x.myshopify.com" },
  syncCursor: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  totalOrdersSynced: 0,
  totalRecordsSynced: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  adapterMock.applyDefaults.mockImplementation((c: Record<string, unknown>) => c);
  adapterMock.maskConfig.mockImplementation((c: Record<string, unknown>) => ({ ...c, masked: true }));
  authMock.mockResolvedValue({ user: { id: "u1", name: "Alice", email: "a@x.com", role: "admin" } });
});

describe("IntegrationsService.listIntegrations", () => {
  it("computes tokenStatus per platform and strips config/syncCursor", async () => {
    repositoryMock.listPlatformIntegrations.mockResolvedValue([
      { ...INTEGRATION, platform: "walmart", config: {} },
      { ...INTEGRATION, platform: "ebay", config: { refreshToken: "rt" } },
      { ...INTEGRATION, platform: "shopify" },
    ]);

    const result = await IntegrationsService.listIntegrations();

    expect(result[0]).not.toHaveProperty("config");
    expect(result[0]).not.toHaveProperty("syncCursor");
    expect(result[0].tokenStatus).toBe("none");
    expect(result[1].tokenStatus).toBe("valid");
    expect(result[2].tokenStatus).toBeUndefined();
  });
});

describe("IntegrationsService.listActiveIntegrations", () => {
  it("delegates to the repository", async () => {
    repositoryMock.listActivePlatformIntegrations.mockResolvedValue([INTEGRATION]);
    expect(await IntegrationsService.listActiveIntegrations()).toEqual([INTEGRATION]);
  });
});

describe("IntegrationsService.getIntegrationForDisplay", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.getIntegrationForDisplay("missing")).rejects.toThrow(NotFoundError);
  });

  it("returns the integration with a masked config", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    const result = await IntegrationsService.getIntegrationForDisplay("int-1");
    expect(result.config).toEqual({ ...INTEGRATION.config, masked: true });
  });
});

describe("IntegrationsService.createIntegration", () => {
  it("throws ValidationError when the live Shopify connection test fails", async () => {
    adapterMock.checkConnection.mockResolvedValue({ success: false, message: "bad token" });

    await expect(
      IntegrationsService.createIntegration({ platform: "shopify", name: "Store", config: {} })
    ).rejects.toThrow("Failed to connect to Shopify: bad token");
    expect(repositoryMock.createPlatformIntegration).not.toHaveBeenCalled();
  });

  it("skips the live check for non-Shopify platforms and creates", async () => {
    repositoryMock.createPlatformIntegration.mockResolvedValue(INTEGRATION);

    await IntegrationsService.createIntegration({ platform: "amazon", name: "Amz", config: { a: 1 } });

    expect(adapterMock.checkConnection).not.toHaveBeenCalled();
    expect(repositoryMock.createPlatformIntegration).toHaveBeenCalledWith({
      platform: "amazon",
      name: "Amz",
      isActive: true,
      config: { a: 1 },
    });
  });
});

describe("IntegrationsService.updateIntegration", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.updateIntegration("missing", {}, null)).rejects.toThrow(NotFoundError);
  });

  it("merges config through the adapter, persists, and audit-logs", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    repositoryMock.updatePlatformIntegration.mockResolvedValue({ ...INTEGRATION, name: "Renamed" });

    await IntegrationsService.updateIntegration("int-1", { name: "Renamed", config: { extra: 1 } }, "1.2.3.4");

    expect(adapterMock.applyDefaults).toHaveBeenCalledWith({ ...INTEGRATION.config, extra: 1 });
    expect(adapterMock.validateConfig).toHaveBeenCalled();
    expect(repositoryMock.updatePlatformIntegration).toHaveBeenCalledWith("int-1", {
      name: "Renamed",
      config: { ...INTEGRATION.config, extra: 1 },
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "integration", action: "config_update", ip: "1.2.3.4" })
    );
  });
});

describe("IntegrationsService.deleteIntegration", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.deleteIntegration("missing", null)).rejects.toThrow(NotFoundError);
  });

  it("deletes and audit-logs", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    await IntegrationsService.deleteIntegration("int-1", "1.2.3.4");
    expect(repositoryMock.deletePlatformIntegration).toHaveBeenCalledWith("int-1");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", ip: "1.2.3.4" }));
  });
});

describe("IntegrationsService.checkConnection", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.checkConnection("missing")).rejects.toThrow(NotFoundError);
  });

  it("persists an updatedConfig returned by the adapter", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    adapterMock.checkConnection.mockResolvedValue({ success: true, updatedConfig: { a: 1 } });

    await IntegrationsService.checkConnection("int-1");

    expect(repositoryMock.updatePlatformIntegration).toHaveBeenCalledWith("int-1", { config: { a: 1 } });
  });

  it("does not persist when no updatedConfig is returned", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    adapterMock.checkConnection.mockResolvedValue({ success: true });

    await IntegrationsService.checkConnection("int-1");

    expect(repositoryMock.updatePlatformIntegration).not.toHaveBeenCalled();
  });
});

describe("IntegrationsService.getSyncStatus", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.getSyncStatus("missing")).rejects.toThrow(NotFoundError);
  });

  it("shapes the sync status response", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({
      ...INTEGRATION,
      lastSyncStatus: "success",
      totalOrdersSynced: 7,
    });

    const result = await IntegrationsService.getSyncStatus("int-1");

    expect(result.sync).toMatchObject({ status: "success", totalOrders: 7 });
  });
});

describe("IntegrationsService.runSync", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.runSync("missing")).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError when the integration is inactive", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({ ...INTEGRATION, isActive: false });
    await expect(IntegrationsService.runSync("int-1")).rejects.toThrow(ValidationError);
  });

  it("queues via Inngest and does not call the adapter", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);

    const result = await IntegrationsService.runSync("int-1", { fullSync: true, useInngest: true });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "app/sync.trigger",
      data: { integrationId: "int-1", fullSync: true },
    });
    expect(adapterMock.sync).not.toHaveBeenCalled();
    expect(result).toEqual({
      queued: true,
      integrationId: "int-1",
      platform: "shopify",
      name: "Main Store",
      fullSync: true,
    });
  });

  it("on full success, clears the sync cursor and increments counters", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    adapterMock.sync.mockResolvedValue({ success: true, ordersProcessed: 5, salesRecordsCreated: 5, skusCreated: 1, errors: [] });

    const result = await IntegrationsService.runSync("int-1");

    expect(repositoryMock.updatePlatformIntegration).toHaveBeenCalledWith(
      "int-1",
      expect.objectContaining({ lastSyncStatus: "success", syncCursor: null, incrementTotalOrdersSynced: 5 })
    );
    expect(result).toMatchObject({ queued: false, success: true, platform: "shopify" });
  });

  it("on partial success, keeps the sync cursor and records the first error", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    adapterMock.sync.mockResolvedValue({ success: true, ordersProcessed: 3, salesRecordsCreated: 3, skusCreated: 0, errors: ["page 4 failed"] });

    await IntegrationsService.runSync("int-1");

    const update = repositoryMock.updatePlatformIntegration.mock.calls[0][1];
    expect(update.lastSyncStatus).toBe("partial");
    expect(update.lastSyncError).toBe("page 4 failed");
    expect(update).not.toHaveProperty("syncCursor");
  });

  it("on failure, marks lastSyncStatus failed with the joined error list", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(INTEGRATION);
    adapterMock.sync.mockResolvedValue({ success: false, ordersProcessed: 0, salesRecordsCreated: 0, skusCreated: 0, errors: ["a", "b"] });

    await IntegrationsService.runSync("int-1");

    expect(repositoryMock.updatePlatformIntegration).toHaveBeenCalledWith("int-1", {
      lastSyncStatus: "failed",
      lastSyncError: "a; b",
    });
  });
});

describe("IntegrationsService.buildEbayAuthUrl", () => {
  it("throws NotFoundError when missing or not an eBay integration", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({ ...INTEGRATION, platform: "shopify" });
    await expect(IntegrationsService.buildEbayAuthUrl("int-1")).rejects.toThrow(NotFoundError);
  });

  it("throws a plain Error when ruName is missing", async () => {
    const original = process.env.EBAY_RUNAME;
    delete process.env.EBAY_RUNAME;
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({ ...INTEGRATION, platform: "ebay", config: {} });

    await expect(IntegrationsService.buildEbayAuthUrl("int-1")).rejects.toThrow(/RuName is not configured/);
    process.env.EBAY_RUNAME = original;
  });

  it("throws ValidationError when clientId/clientSecret are missing", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({
      ...INTEGRATION,
      platform: "ebay",
      config: { ruName: "ru-1" },
    });
    validateEbayConfigMock.mockImplementation(() => {
      throw new Error("missing creds");
    });

    await expect(IntegrationsService.buildEbayAuthUrl("int-1")).rejects.toThrow(ValidationError);
  });

  it("builds the authorization URL on success", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({
      ...INTEGRATION,
      platform: "ebay",
      config: { ruName: "ru-1", clientId: "cid", clientSecret: "secret" },
    });
    validateEbayConfigMock.mockImplementation(() => {});
    buildAuthorizationUrlMock.mockReturnValue("https://auth.ebay.com/oauth2/authorize?...");

    const url = await IntegrationsService.buildEbayAuthUrl("int-1");

    expect(url).toBe("https://auth.ebay.com/oauth2/authorize?...");
    expect(buildAuthorizationUrlMock).toHaveBeenCalledWith("ru-1", "int-1");
  });
});

describe("IntegrationsService.completeEbayAuth", () => {
  it("throws NotFoundError when missing or not an eBay integration", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue(null);
    await expect(IntegrationsService.completeEbayAuth("code", "int-1")).rejects.toThrow(NotFoundError);
  });

  it("throws a plain Error when ruName is missing", async () => {
    const original = process.env.EBAY_RUNAME;
    delete process.env.EBAY_RUNAME;
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({ ...INTEGRATION, platform: "ebay", config: {} });

    await expect(IntegrationsService.completeEbayAuth("code", "int-1")).rejects.toThrow(
      "RuName is not configured for this integration"
    );
    process.env.EBAY_RUNAME = original;
  });

  it("exchanges the code and persists the merged config with new tokens", async () => {
    repositoryMock.getPlatformIntegrationById.mockResolvedValue({
      ...INTEGRATION,
      platform: "ebay",
      config: { ruName: "ru-1", clientId: "cid", clientSecret: "secret", other: "keep-me" },
    });
    exchangeCodeForTokensMock.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z",
    });

    await IntegrationsService.completeEbayAuth("auth-code", "int-1");

    expect(exchangeCodeForTokensMock).toHaveBeenCalledWith("auth-code", "ru-1");
    expect(repositoryMock.updatePlatformIntegration).toHaveBeenCalledWith("int-1", {
      config: expect.objectContaining({
        other: "keep-me",
        refreshToken: "rt",
        refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z",
      }),
    });
  });
});
