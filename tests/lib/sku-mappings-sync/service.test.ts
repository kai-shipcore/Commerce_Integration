import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  getKitComponentMappings: vi.fn(),
  ensureProductsExist: vi.fn(),
  syncMappings: vi.fn(),
};
vi.mock("@/lib/sku-mappings-sync/repository", () => ({ SkuMappingsSyncRepository: repositoryMock }));

const { SkuMappingsSyncService } = await import("@/lib/sku-mappings-sync/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuMappingsSyncService.sync", () => {
  it("deduplicates parent/component pairs before syncing", async () => {
    repositoryMock.getKitComponentMappings.mockResolvedValue([
      { parent_kit_sku: "KIT-1", component_sku: "SKU-1" },
      { parent_kit_sku: "KIT-1", component_sku: "SKU-1" }, // duplicate
      { parent_kit_sku: "KIT-2", component_sku: "SKU-2" },
    ]);
    repositoryMock.syncMappings.mockResolvedValue({ mappingsUpserted: 2, mappingsDeleted: 0 });

    const result = await SkuMappingsSyncService.sync();

    expect(repositoryMock.ensureProductsExist).toHaveBeenCalledWith(["SKU-1", "SKU-2"]);
    expect(repositoryMock.syncMappings).toHaveBeenCalledWith([
      { channel_sku: "KIT-1", master_sku: "SKU-1" },
      { channel_sku: "KIT-2", master_sku: "SKU-2" },
    ]);
    expect(result).toEqual({ mappingsUpserted: 2, mappingsDeleted: 0 });
  });

  it("passes an empty distinct-sku list through when there are no mappings", async () => {
    repositoryMock.getKitComponentMappings.mockResolvedValue([]);
    repositoryMock.syncMappings.mockResolvedValue({ mappingsUpserted: 0, mappingsDeleted: 0 });

    await SkuMappingsSyncService.sync();

    expect(repositoryMock.ensureProductsExist).toHaveBeenCalledWith([]);
  });
});
