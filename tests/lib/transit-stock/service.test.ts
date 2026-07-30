import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  listRecords: vi.fn(),
  createRecord: vi.fn(),
  createManyRecords: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  syncStats: vi.fn(),
};

const logAuditMock = vi.fn();

vi.mock("@/lib/transit-stock/repository", () => ({ TransitStockRepository: repositoryMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { TransitStockService } = await import("@/lib/transit-stock/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TransitStockService.listRecords", () => {
  it("serializes BigInt ids to strings", async () => {
    repositoryMock.listRecords.mockResolvedValue([{ id: BigInt(7), masterSku: "SKU-1" }]);
    const result = await TransitStockService.listRecords(null);
    expect(result[0].id).toBe("7");
  });
});

describe("TransitStockService.createRecord", () => {
  it("creates, syncs stats for the sku, and audit-logs", async () => {
    repositoryMock.createRecord.mockResolvedValue({ id: BigInt(1), masterSku: "SKU-1" });

    const result = await TransitStockService.createRecord(
      { sourceWarehouseCode: "A", destWarehouseCode: "B", masterSku: "SKU-1", qty: 5 },
      WHO, "1.2.3.4",
    );

    expect(result.id).toBe("1");
    expect(repositoryMock.syncStats).toHaveBeenCalledWith(["SKU-1"]);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "transit_record", action: "create", entityId: "1", ip: "1.2.3.4",
    }));
  });
});

describe("TransitStockService.importRecords", () => {
  it("dedupes skus before syncing stats and audit-logs the batch", async () => {
    repositoryMock.createManyRecords.mockResolvedValue(3);

    const inserted = await TransitStockService.importRecords(
      { sourceWarehouseCode: "A", destWarehouseCode: "B", rows: [
        { masterSku: "SKU-1", qty: 1 },
        { masterSku: "SKU-1", qty: 2 },
        { masterSku: "SKU-2", qty: 3 },
      ] },
      WHO, null,
    );

    expect(inserted).toBe(3);
    expect(repositoryMock.syncStats).toHaveBeenCalledWith(["SKU-1", "SKU-2"]);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "create", after: expect.objectContaining({ rowCount: 3 }) }));
  });

  it("defaults a missing notes field to an empty string per row", async () => {
    repositoryMock.createManyRecords.mockResolvedValue(1);
    await TransitStockService.importRecords(
      { sourceWarehouseCode: "A", destWarehouseCode: "B", rows: [{ masterSku: "SKU-1", qty: 1 }] },
      WHO, null,
    );
    const rows = repositoryMock.createManyRecords.mock.calls[0][2];
    expect(rows[0].notes).toBe("");
  });
});

describe("TransitStockService.updateRecord", () => {
  it("throws ValidationError when no field is provided", async () => {
    await expect(TransitStockService.updateRecord("1", {}, WHO, null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.updateRecord).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the repository reports no match", async () => {
    repositoryMock.updateRecord.mockResolvedValue(null);
    await expect(TransitStockService.updateRecord("1", { qty: 5 }, WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("syncs stats for the record's sku and uses status_change when status is set", async () => {
    repositoryMock.updateRecord.mockResolvedValue({ masterSku: "SKU-1" });
    await TransitStockService.updateRecord("1", { status: "arrived" }, WHO, null);
    expect(repositoryMock.syncStats).toHaveBeenCalledWith(["SKU-1"]);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));
  });

  it("uses a generic update action when only qty/notes change", async () => {
    repositoryMock.updateRecord.mockResolvedValue({ masterSku: "SKU-1" });
    await TransitStockService.updateRecord("1", { qty: 9 }, WHO, null);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "update" }));
  });
});

describe("TransitStockService.deleteRecord", () => {
  it("throws NotFoundError when the repository reports no match", async () => {
    repositoryMock.deleteRecord.mockResolvedValue(null);
    await expect(TransitStockService.deleteRecord("1", WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("syncs stats for the deleted record's sku and audit-logs", async () => {
    repositoryMock.deleteRecord.mockResolvedValue({ masterSku: "SKU-1", status: "in_transit", qty: 5, sourceWarehouseCode: "A", destWarehouseCode: "B" });
    await TransitStockService.deleteRecord("1", WHO, "9.9.9.9");
    expect(repositoryMock.syncStats).toHaveBeenCalledWith(["SKU-1"]);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", ip: "9.9.9.9" }));
  });
});
