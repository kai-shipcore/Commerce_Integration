import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.fn();
const findUniqueMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    warehouse: { findMany: findManyMock, findUnique: findUniqueMock, create: createMock, update: updateMock },
  },
}));
vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { WarehousesRepository } = await import("@/lib/warehouses/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WarehousesRepository.findMany", () => {
  it("builds an empty where clause with no filters", async () => {
    findManyMock.mockResolvedValue([]);
    await WarehousesRepository.findMany({ search: "", type: "", active: null });
    expect(findManyMock).toHaveBeenCalledWith({ where: {}, orderBy: { warehouseCode: "asc" } });
  });

  it("combines search, type, and active filters", async () => {
    findManyMock.mockResolvedValue([]);
    await WarehousesRepository.findMany({ search: "west", type: "own", active: true });

    const { where } = findManyMock.mock.calls[0][0];
    expect(where.warehouseType).toBe("own");
    expect(where.isActive).toBe(true);
    expect(where.OR).toEqual([
      { warehouseCode: { contains: "west", mode: "insensitive" } },
      { warehouseName: { contains: "west", mode: "insensitive" } },
    ]);
  });
});

describe("WarehousesRepository.findById", () => {
  it("converts the string id to BigInt for the lookup", async () => {
    findUniqueMock.mockResolvedValue({ id: BigInt(1) });
    await WarehousesRepository.findById("1");
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: BigInt(1) } });
  });
});

describe("WarehousesRepository.listActiveForDropdown", () => {
  it("queries fc_warehouses for active rows only", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ warehouseCode: "WH1", warehouseName: "West", warehouseType: "own" }] });

    const rows = await WarehousesRepository.listActiveForDropdown();

    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining("is_active = true"));
    expect(rows).toEqual([{ warehouseCode: "WH1", warehouseName: "West", warehouseType: "own" }]);
  });
});
