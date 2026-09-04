import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const findManyMock = vi.fn();
const createMock = vi.fn();
const createManyMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transitRecord: { findMany: findManyMock, create: createMock, createMany: createManyMock, update: updateMock, delete: deleteMock },
  },
}));
vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { TransitStockRepository } = await import("@/lib/transit-stock/repository");

function notFoundError() {
  return new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "test" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TransitStockRepository.listRecords", () => {
  it("passes no where filter when statusFilter is null", async () => {
    findManyMock.mockResolvedValue([]);
    await TransitStockRepository.listRecords(null);
    expect(findManyMock).toHaveBeenCalledWith({ where: undefined, orderBy: { createdAt: "desc" } });
  });

  it("filters by status when given", async () => {
    findManyMock.mockResolvedValue([]);
    await TransitStockRepository.listRecords("arrived");
    expect(findManyMock).toHaveBeenCalledWith({ where: { status: "arrived" }, orderBy: { createdAt: "desc" } });
  });
});

describe("TransitStockRepository.searchMasterSkus", () => {
  it("filters active products by the search term and reads the window count", async () => {
    poolQueryMock.mockResolvedValue({ rows: [
      { master_sku: "SKU-1", total: "2" },
      { master_sku: "SKU-2", total: "2" },
    ] });

    const result = await TransitStockRepository.searchMasterSkus("sku", 50);

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("FROM shipcore.fc_products");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("COUNT(*) OVER ()");
    expect(params).toEqual(["sku", 50]);
    expect(result).toEqual({ skus: ["SKU-1", "SKU-2"], total: 2 });
  });

  it("reports total 0 when nothing matches", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    const result = await TransitStockRepository.searchMasterSkus("nope", 50);
    expect(result).toEqual({ skus: [], total: 0 });
  });
});

describe("TransitStockRepository.createRecord", () => {
  it("forces status to in_transit", async () => {
    createMock.mockResolvedValue({ id: BigInt(1) });
    await TransitStockRepository.createRecord({ sourceWarehouseCode: "A", destWarehouseCode: "B", masterSku: "SKU-1", qty: 5, notes: null });
    expect(createMock).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "in_transit" }) });
  });
});

describe("TransitStockRepository.createManyRecords", () => {
  it("stamps every row with the shared source/dest and returns the insert count", async () => {
    createManyMock.mockResolvedValue({ count: 3 });
    const count = await TransitStockRepository.createManyRecords("A", "B", [
      { masterSku: "SKU-1", qty: 1, notes: "" },
      { masterSku: "SKU-2", qty: 2, notes: "" },
      { masterSku: "SKU-3", qty: 3, notes: "" },
    ]);
    expect(count).toBe(3);
    const { data } = createManyMock.mock.calls[0][0];
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ sourceWarehouseCode: "A", destWarehouseCode: "B", status: "in_transit" });
  });
});

describe("TransitStockRepository.updateRecord", () => {
  it("returns null when Prisma reports the record was not found", async () => {
    updateMock.mockRejectedValue(notFoundError());
    const result = await TransitStockRepository.updateRecord("1", { status: "arrived" });
    expect(result).toBeNull();
  });

  it("rethrows unrelated errors", async () => {
    updateMock.mockRejectedValue(new Error("connection reset"));
    await expect(TransitStockRepository.updateRecord("1", { status: "arrived" })).rejects.toThrow("connection reset");
  });

  it("converts the id to BigInt for the lookup", async () => {
    updateMock.mockResolvedValue({ id: BigInt(1), masterSku: "SKU-1" });
    await TransitStockRepository.updateRecord("1", { qty: 3 });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: BigInt(1) }, data: { qty: 3 } });
  });
});

describe("TransitStockRepository.deleteRecord", () => {
  it("returns null when Prisma reports the record was not found", async () => {
    deleteMock.mockRejectedValue(notFoundError());
    const result = await TransitStockRepository.deleteRecord("1");
    expect(result).toBeNull();
  });
});

describe("TransitStockRepository.syncStats", () => {
  it("short-circuits for an empty sku list", async () => {
    await TransitStockRepository.syncStats([]);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("updates both fc_stats and fc_stats_custom for the given skus", async () => {
    poolQueryMock.mockResolvedValue({});
    await TransitStockRepository.syncStats(["SKU-1", "SKU-2"]);
    expect(poolQueryMock).toHaveBeenCalledTimes(2);
    const [sql1, params1] = poolQueryMock.mock.calls[0];
    expect(sql1).toContain("fc_stats s SET transit_stock");
    expect(params1).toEqual([["SKU-1", "SKU-2"]]);
    const [sql2] = poolQueryMock.mock.calls[1];
    expect(sql2).toContain("fc_stats_custom s SET transit_stock");
  });
});

describe("TransitStockRepository.syncAllStats", () => {
  it("reconciles both stats tables from all in-transit records", async () => {
    poolQueryMock.mockResolvedValue({});

    await TransitStockRepository.syncAllStats();

    expect(poolQueryMock).toHaveBeenCalledTimes(2);
    const [linkSql] = poolQueryMock.mock.calls[0];
    const [customSql] = poolQueryMock.mock.calls[1];
    expect(linkSql).toContain("UPDATE shipcore.fc_stats s");
    expect(customSql).toContain("UPDATE shipcore.fc_stats_custom s");
    expect(linkSql).toContain("FROM shipcore.fc_transit_records");
    expect(linkSql).toContain("status = 'in_transit'");
    expect(linkSql).toContain("IS DISTINCT FROM");
  });
});
