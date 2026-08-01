import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = { getLookupRows: vi.fn(), upsertProducts: vi.fn() };
vi.mock("@/lib/products-sync/repository", () => ({ ProductsSyncRepository: repositoryMock }));

const { ProductsSyncService } = await import("@/lib/products-sync/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductsSyncService.sync", () => {
  it("upserts the lookup rows and reports the count with 0 deleted", async () => {
    repositoryMock.getLookupRows.mockResolvedValue([{ master_sku: "SKU-1" }, { master_sku: "SKU-2" }]);
    const result = await ProductsSyncService.sync();
    expect(repositoryMock.upsertProducts).toHaveBeenCalledWith([{ master_sku: "SKU-1" }, { master_sku: "SKU-2" }]);
    expect(result).toEqual({ productsUpserted: 2, productsDeleted: 0 });
  });
});
