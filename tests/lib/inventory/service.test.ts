import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  queryCoverlandInventory: vi.fn(),
};

const cacheManagerMock = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock("@/lib/inventory/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inventory/repository")>("@/lib/inventory/repository");
  return { ...actual, InventoryRepository: repositoryMock };
});
vi.mock("@/lib/redis", () => ({ CacheManager: cacheManagerMock }));

const { InventoryService } = await import("@/lib/inventory/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InventoryService.resolveQuery", () => {
  it("applies defaults and clamps limit for non-export requests", () => {
    const resolved = InventoryService.resolveQuery({});

    expect(resolved).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
      exportAll: false,
      search: "",
      warehouse: "",
      groupBy: "warehouse",
      sortBy: "masterSku",
      sortOrder: "asc",
    });
  });

  it("uses a much higher limit ceiling when exportAll is set", () => {
    const resolved = InventoryService.resolveQuery({ exportAll: true, limit: 999999 });

    expect(resolved.limit).toBe(100000);
    expect(resolved.exportAll).toBe(true);
  });

  it("falls back to masterSku sort when warehouse-only sort keys don't apply to the current groupBy", () => {
    const byProduct = InventoryService.resolveQuery({ groupBy: "product", sortBy: "warehouse" });
    expect(byProduct.sortBy).toBe("masterSku");

    const byWarehouse = InventoryService.resolveQuery({ groupBy: "warehouse", sortBy: "warehouseCount" });
    expect(byWarehouse.sortBy).toBe("masterSku");
  });

  it("falls back to masterSku for an unrecognized sort key", () => {
    // @ts-expect-error - intentionally invalid input, mirroring an unchecked query-string cast
    expect(InventoryService.resolveQuery({ sortBy: "bogus" }).sortBy).toBe("masterSku");
  });

  it("passes through a valid sortOrder", () => {
    expect(InventoryService.resolveQuery({ sortOrder: "desc" }).sortOrder).toBe("desc");
  });
});

describe("InventoryService.getInventory", () => {
  it("returns the cached result without hitting the repository query on a cache hit", async () => {
    const cached = { rows: [], totalRows: 0, totalProducts: 0, totalWarehouses: 0, totals: { onHand: 0, allocated: 0, available: 0, backorder: 0 }, warehouses: [] };
    cacheManagerMock.get.mockResolvedValue(cached);

    const result = await InventoryService.getInventory({});

    expect(result).toBe(cached);
    expect(repositoryMock.queryCoverlandInventory).not.toHaveBeenCalled();
  });

  it("queries the repository and caches the result on a cache miss", async () => {
    cacheManagerMock.get.mockResolvedValue(null);
    const fresh = { rows: [], totalRows: 5, totalProducts: 1, totalWarehouses: 1, totals: { onHand: 1, allocated: 0, available: 1, backorder: 0 }, warehouses: ["WH1"] };
    repositoryMock.queryCoverlandInventory.mockResolvedValue(fresh);

    const result = await InventoryService.getInventory({});

    expect(result).toBe(fresh);
    expect(cacheManagerMock.set).toHaveBeenCalledWith(
      "inventory:v3:warehouse:1:20:masterSku:asc::",
      fresh,
      120
    );
  });

  it("bypasses the cache entirely when exportAll is set", async () => {
    const fresh = { rows: [], totalRows: 0, totalProducts: 0, totalWarehouses: 0, totals: { onHand: 0, allocated: 0, available: 0, backorder: 0 }, warehouses: [] };
    repositoryMock.queryCoverlandInventory.mockResolvedValue(fresh);

    await InventoryService.getInventory({ exportAll: true });

    expect(cacheManagerMock.get).not.toHaveBeenCalled();
    expect(cacheManagerMock.set).not.toHaveBeenCalled();
  });
});
