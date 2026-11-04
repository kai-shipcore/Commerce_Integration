import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  list: vi.fn(),
  findExistingProductSkus: vi.fn(),
  getForUpdate: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const invalidateCacheMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/lib/sku-min-sales/repository", () => ({ SkuMinSalesRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateCacheMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { SkuMinSalesService } = await import("@/lib/sku-min-sales/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuMinSalesService.save", () => {
  it("normalizes the SKU, rounds to 4 decimals, and upserts inside a transaction", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue(null);
    repositoryMock.upsert.mockResolvedValue(true);

    const result = await SkuMinSalesService.save([{ masterSku: " sku-1 ", minTotalAvgCurr: 2.123456, note: "  " }], WHO, "1.2.3.4");

    expect(result).toEqual({ inserted: 1, updated: 0, total: 1 });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(repositoryMock.upsert).toHaveBeenCalledWith(
      { masterSku: "SKU-1", minTotalAvgCurr: 2.1235, note: null },
      "Alice",
      expect.anything(),
    );
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sku_min_sales", entityId: "SKU-1", action: "create", after: { minTotalAvgCurr: 2.1235 },
    }));
  });

  it("rejects the whole batch when any SKU is missing from SKU Master", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    await expect(SkuMinSalesService.save(
      [{ masterSku: "SKU-1", minTotalAvgCurr: 1 }, { masterSku: "SKU-X", minTotalAvgCurr: 1 }],
      WHO, null,
    )).rejects.toThrow("SKU does not exist in SKU Master: SKU-X");
    expect(repositoryMock.upsert).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it("rejects a negative minimum", async () => {
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", minTotalAvgCurr: -1 }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps the last row when a sheet repeats a SKU, and logs an update with the previous value", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue({ masterSku: "SKU-1", minTotalAvgCurr: 1, note: null });
    repositoryMock.upsert.mockResolvedValue(false);

    const result = await SkuMinSalesService.save(
      [{ masterSku: "SKU-1", minTotalAvgCurr: 2 }, { masterSku: "sku-1", minTotalAvgCurr: 4 }],
      WHO, null,
    );

    expect(result).toEqual({ inserted: 0, updated: 1, total: 1 });
    expect(repositoryMock.upsert).toHaveBeenCalledTimes(1);
    expect(repositoryMock.upsert.mock.calls[0][0]).toMatchObject({ minTotalAvgCurr: 4 });
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "update", before: { minTotalAvgCurr: 1 }, after: { minTotalAvgCurr: 4 },
    }));
  });

  it("does not audit-log a save that changes nothing", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue({ masterSku: "SKU-1", minTotalAvgCurr: 2, note: null });
    repositoryMock.upsert.mockResolvedValue(false);

    await SkuMinSalesService.save([{ masterSku: "SKU-1", minTotalAvgCurr: 2 }], WHO, null);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("SkuMinSalesService.remove", () => {
  it("deletes, invalidates the cache, and audit-logs each removed SKU", async () => {
    repositoryMock.deleteMany.mockResolvedValue(["SKU-1", "SKU-2"]);
    const result = await SkuMinSalesService.remove([" sku-1", "SKU-2", "SKU-2"], WHO, null);
    expect(repositoryMock.deleteMany).toHaveBeenCalledWith(["SKU-1", "SKU-2"]);
    expect(result).toEqual({ skus: ["SKU-1", "SKU-2"] });
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });

  it("throws NotFoundError when nothing was registered", async () => {
    repositoryMock.deleteMany.mockResolvedValue([]);
    await expect(SkuMinSalesService.remove(["SKU-1"], WHO, null)).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it("rejects an empty sku list", async () => {
    await expect(SkuMinSalesService.remove([" "], WHO, null)).rejects.toBeInstanceOf(ValidationError);
  });
});
