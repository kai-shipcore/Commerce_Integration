import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  listStock: vi.fn(),
  findProductCbmMap: vi.fn(),
  productExists: vi.fn(),
  insertStockIfNotExists: vi.fn(),
  insertStock: vi.fn(),
  getStockForUpdate: vi.fn(),
  updateStock: vi.fn(),
  getStocksForDeleteCheck: vi.fn(),
  deleteStocks: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const invalidateCacheMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/lib/available-stock/repository", () => ({ AvailableStockRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateCacheMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { AvailableStockService } = await import("@/lib/available-stock/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AvailableStockService.importStock", () => {
  it("normalizes rows and throws ValidationError listing every missing sku", async () => {
    repositoryMock.findProductCbmMap.mockResolvedValue(new Map());
    await expect(
      AvailableStockService.importStock(
        [{ sourceType: "remaining", referenceNo: " R1 ", masterSku: " sku-1 ", totalQty: 1 }],
        WHO, null,
      ),
    ).rejects.toThrow("SKU does not exist in SKU Master: SKU-1");
  });

  it("throws when a row has no usable cbm from input or product lookup", async () => {
    repositoryMock.findProductCbmMap.mockResolvedValue(new Map([["SKU-1", 0]]));
    await expect(
      AvailableStockService.importStock([{ sourceType: "remaining", referenceNo: "R1", masterSku: "SKU-1", totalQty: 1 }], WHO, null),
    ).rejects.toThrow("No CBM per unit on file for SKU-1.");
  });

  it("counts inserted vs skipped, invalidates cache, and audit-logs", async () => {
    repositoryMock.findProductCbmMap.mockResolvedValue(new Map([["SKU-1", 2]]));
    repositoryMock.insertStockIfNotExists.mockResolvedValueOnce("1").mockResolvedValueOnce(null);

    const result = await AvailableStockService.importStock(
      [
        { sourceType: "remaining", referenceNo: "R1", masterSku: "SKU-1", totalQty: 1 },
        { sourceType: "remaining", referenceNo: "R1", masterSku: "SKU-1", totalQty: 1 },
      ],
      WHO, "1.2.3.4",
    );

    expect(result).toEqual({ inserted: 1, skipped: 1, total: 2 });
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ entityType: "available_stock", action: "create", ip: "1.2.3.4" }));
  });
});

describe("AvailableStockService.createStock", () => {
  it("throws ValidationError when the sku isn't in SKU Master", async () => {
    repositoryMock.productExists.mockResolvedValue(false);
    await expect(
      AvailableStockService.createStock({ sourceType: "remaining", referenceNo: "R1", masterSku: "sku-1", totalQty: 1, cbm: 1 }, WHO, null),
    ).rejects.toThrow(ValidationError);
    expect(repositoryMock.insertStock).not.toHaveBeenCalled();
  });

  it("uppercases the sku, creates, invalidates cache, and audit-logs", async () => {
    repositoryMock.productExists.mockResolvedValue(true);
    repositoryMock.insertStock.mockResolvedValue("7");

    const result = await AvailableStockService.createStock(
      { sourceType: "remaining", referenceNo: "R1", masterSku: "sku-1", totalQty: 1, cbm: 1 }, WHO, null,
    );

    expect(result).toEqual({ id: "7" });
    expect(repositoryMock.insertStock).toHaveBeenCalledWith(expect.objectContaining({ masterSku: "SKU-1" }));
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "create" }));
  });
});

describe("AvailableStockService.updateStock", () => {
  const input = { sourceType: "remaining" as const, referenceNo: "R1", masterSku: "SKU-1", totalQty: 5, cbm: 1 };

  it("throws ValidationError when the sku isn't in SKU Master", async () => {
    repositoryMock.productExists.mockResolvedValue(false);
    await expect(AvailableStockService.updateStock("1", input, WHO, null)).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when the record doesn't exist", async () => {
    repositoryMock.productExists.mockResolvedValue(true);
    repositoryMock.getStockForUpdate.mockResolvedValue(null);
    await expect(AvailableStockService.updateStock("1", input, WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when totalQty drops below the allocated quantity", async () => {
    repositoryMock.productExists.mockResolvedValue(true);
    repositoryMock.getStockForUpdate.mockResolvedValue({ sourceType: "remaining", masterSku: "SKU-1", cbm: 1, allocatedQty: 10 });
    await expect(AvailableStockService.updateStock("1", { ...input, totalQty: 5 }, WHO, null)).rejects.toThrow(
      "Quantity cannot be less than allocated quantity (10).",
    );
  });

  it("throws ConflictError when allocated stock changes sourceType/sku/cbm", async () => {
    repositoryMock.productExists.mockResolvedValue(true);
    repositoryMock.getStockForUpdate.mockResolvedValue({ sourceType: "mistake", masterSku: "SKU-1", cbm: 1, allocatedQty: 2 });
    await expect(AvailableStockService.updateStock("1", input, WHO, null)).rejects.toThrow(ConflictError);
  });

  it("updates, invalidates cache, and audit-logs on success", async () => {
    repositoryMock.productExists.mockResolvedValue(true);
    repositoryMock.getStockForUpdate.mockResolvedValue({ sourceType: "remaining", masterSku: "SKU-1", cbm: 1, allocatedQty: 0 });

    const result = await AvailableStockService.updateStock("1", input, WHO, null);

    expect(result).toEqual({ id: "1" });
    expect(repositoryMock.updateStock).toHaveBeenCalled();
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "update" }));
  });
});

describe("AvailableStockService.deleteStock", () => {
  it("throws NotFoundError when any id doesn't resolve", async () => {
    repositoryMock.getStocksForDeleteCheck.mockResolvedValue([{ id: "1", allocatedQty: 0 }]);
    await expect(AvailableStockService.deleteStock(["1", "2"], WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError with a pluralized message when some rows are allocated", async () => {
    repositoryMock.getStocksForDeleteCheck.mockResolvedValue([{ id: "1", allocatedQty: 2 }, { id: "2", allocatedQty: 0 }]);
    await expect(AvailableStockService.deleteStock(["1", "2"], WHO, null)).rejects.toThrow(
      "Allocated stock cannot be deleted. 1 of 2 selected items have a container allocation — remove it first.",
    );
  });

  it("throws ConflictError with a singular message for one blocked row", async () => {
    repositoryMock.getStocksForDeleteCheck.mockResolvedValue([{ id: "1", allocatedQty: 2 }]);
    await expect(AvailableStockService.deleteStock(["1"], WHO, null)).rejects.toThrow(
      "Allocated stock cannot be deleted. Remove its container allocation first.",
    );
  });

  it("deletes, invalidates cache, and audit-logs on success", async () => {
    repositoryMock.getStocksForDeleteCheck.mockResolvedValue([{ id: "1", allocatedQty: 0 }]);
    const result = await AvailableStockService.deleteStock(["1"], WHO, "9.9.9.9");
    expect(result).toEqual({ ids: ["1"] });
    expect(repositoryMock.deleteStocks).toHaveBeenCalled();
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", ip: "9.9.9.9" }));
  });
});
